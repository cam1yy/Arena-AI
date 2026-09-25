import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { campaignRecipients, closeDb, emailMessages, getDb, integrations, prospects, suppressions } from '@localy/database';
import { encryptSecret, inbox, sending } from '@localy/core';
import { getApp, signUp } from '../support/harness';

let app: Awaited<ReturnType<typeof getApp>>;
beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

type Setup = Awaited<ReturnType<typeof setup>>;

async function setup(opts: { prospects?: number; noEmail?: number } = {}) {
  const u = await signUp(app, { workspaceName: 'Sender Co' });
  const sandbox = await u.client.json<{ integrationId: string }>('POST', '/api/integrations/sandbox/connect', {});
  expect(sandbox.status).toBe(200);
  const ids: string[] = [];
  for (let i = 0; i < (opts.prospects ?? 2); i++) {
    const r = await u.client.json<{ id: string }>('POST', '/api/prospects', { name: `Prospect ${i}`, contactFirstName: `Owner${i}`, email: `owner${i}.${Date.now()}@shop.test`, locationLabel: 'Sea Point', categoryLabel: 'barber' });
    ids.push(r.body.id);
  }
  for (let i = 0; i < (opts.noEmail ?? 0); i++) {
    const r = await u.client.json<{ id: string }>('POST', '/api/prospects', { name: `No Email ${i}` });
    ids.push(r.body.id);
  }
  return { ...u, integrationId: sandbox.body.integrationId, prospectIds: ids };
}

async function createCampaign(s: Setup, steps = [{ subject: 'A website idea for {{businessName}}', body: 'Hi {{firstName}}, I found {{businessName}} in {{location}}.', waitDays: 0, enabled: true }, { subject: 'Re: A website idea for {{businessName}}', body: 'Following up, {{firstName}}.', waitDays: 3, enabled: true }], extra: Record<string, unknown> = {}) {
  const res = await s.client.json<{ campaign: { id: string } }>('POST', '/api/campaigns', {
    name: 'Test campaign',
    integrationId: s.integrationId,
    dailyLimit: 50,
    timezone: 'UTC',
    sendWindowStart: 0,
    sendWindowEnd: 24,
    sendDays: [1, 2, 3, 4, 5, 6, 7],
    stopOnReply: true,
    steps,
    prospectIds: s.prospectIds,
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.campaign.id;
}

/** Runs the worker pipeline synchronously: tick, then send each queued message. */
async function drain(campaignId: string) {
  const db = getDb();
  await sending.processCampaignTick(db, campaignId);
  const queued = await db.select({ id: emailMessages.id }).from(emailMessages).where(and(eq(emailMessages.campaignId, campaignId), eq(emailMessages.status, 'queued')));
  for (const m of queued) await sending.processSendEmail(db, m.id);
  return queued.length;
}

async function makeFollowUpsDue(campaignId: string) {
  await getDb().update(campaignRecipients).set({ nextSendAt: new Date(Date.now() - 1000) }).where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, 'in_progress')));
}

describe('campaigns and the sending pipeline', () => {
  it('does not send anything until the campaign is explicitly started with confirmation', async () => {
    const s = await setup();
    const id = await createCampaign(s);
    expect(await drain(id)).toBe(0);
    const noConfirm = await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start' });
    expect(noConfirm.status).toBe(400);
    const started = await s.client.json<{ campaign: { status: string } }>('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    expect(started.body.campaign.status).toBe('active');
  });

  it('sends personalized emails, schedules follow-ups, then completes the sequence', async () => {
    const s = await setup();
    const id = await createCampaign(s);
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    expect(await drain(id)).toBe(2);
    const sent = await getDb().select().from(emailMessages).where(and(eq(emailMessages.campaignId, id), eq(emailMessages.status, 'sent')));
    expect(sent).toHaveLength(2);
    const first = sent.find((m) => m.toEmail.startsWith('owner0'))!;
    expect(first.subject).toBe('A website idea for Prospect 0');
    expect(first.bodyText).toContain('Hi Owner0, I found Prospect 0 in Sea Point.');
    expect(first.bodyText).toMatch(/unsubscribe here: http:\/\/localhost:5173\/u\//);
    // Follow-up is scheduled 3 days out and not sent early.
    const recs = await getDb().select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
    expect(recs.every((r) => r.status === 'in_progress' && r.currentStep === 1)).toBe(true);
    const due = recs[0].nextSendAt!.getTime() - Date.now();
    expect(due).toBeGreaterThan(2.9 * 86_400_000);
    expect(await drain(id)).toBe(0);
    // When due, follow-ups go out in the same thread and complete the sequence.
    await makeFollowUpsDue(id);
    expect(await drain(id)).toBe(2);
    const followUps = await getDb().select().from(emailMessages).where(and(eq(emailMessages.campaignId, id), eq(emailMessages.stepPosition, 1)));
    expect(followUps.every((m) => m.status === 'sent' && m.inReplyTo)).toBe(true);
    await sending.processCampaignTick(getDb(), id);
    const c = await s.client.json<{ campaign: { status: string; stats: { sent: number; followUpsSent: number } } }>('GET', `/api/campaigns/${id}`);
    expect(c.body.campaign.status).toBe('completed');
    expect(c.body.campaign.stats).toMatchObject({ sent: 4, followUpsSent: 2 });
    // Prospects moved to Contacted with a timeline.
    const [p] = await getDb().select().from(prospects).where(eq(prospects.id, s.prospectIds[0]));
    expect(p.status).toBe('contacted');
  });

  it('never sends the same step twice, even if the worker processes a message repeatedly', async () => {
    const s = await setup({ prospects: 1 });
    const id = await createCampaign(s);
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    await sending.processCampaignTick(getDb(), id);
    await sending.processCampaignTick(getDb(), id);
    const queued = await getDb().select().from(emailMessages).where(eq(emailMessages.campaignId, id));
    expect(queued).toHaveLength(1);
    const results = await Promise.all([sending.processSendEmail(getDb(), queued[0].id), sending.processSendEmail(getDb(), queued[0].id), sending.processSendEmail(getDb(), queued[0].id)]);
    expect(results.filter((r) => r.status === 'sent')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'skipped')).toHaveLength(2);
  });

  it('makes composer sends idempotent', async () => {
    const s = await setup({ prospects: 2 });
    const body = { prospectIds: s.prospectIds, integrationId: s.integrationId, subject: 'Hello {{businessName}}', body: 'Hi {{firstName}}', followUps: [], idempotencyKey: `key-${Date.now()}` };
    const a = await s.client.json<{ campaign: { id: string }; duplicate: boolean }>('POST', '/api/compose/send', body);
    const b = await s.client.json<{ campaign: { id: string }; duplicate: boolean }>('POST', '/api/compose/send', body);
    expect(a.status).toBe(200);
    expect(a.body.duplicate).toBe(false);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.campaign.id).toBe(a.body.campaign.id);
    await drain(a.body.campaign.id);
    const sent = await getDb().select().from(emailMessages).where(eq(emailMessages.campaignId, a.body.campaign.id));
    expect(sent).toHaveLength(2);
  });

  it('stops follow-ups when a prospect replies and records the reply in the inbox', async () => {
    const s = await setup({ prospects: 2 });
    const id = await createCampaign(s);
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    await drain(id);
    const threads = await s.client.json<{ items: { id: string; prospectId: string }[] }>('GET', '/api/inbox');
    const t = threads.body.items.find((x) => x.prospectId === s.prospectIds[0])!;
    const r = await s.client.json<{ result: string }>('POST', `/api/inbox/${t.id}/simulate-reply`, { body: 'Yes please!\n\nOn Mon, you wrote:\n> Hi' });
    expect(r.body.result).toBe('recorded');
    await makeFollowUpsDue(id);
    expect(await drain(id)).toBe(1);
    const [replied] = await getDb().select().from(campaignRecipients).where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.prospectId, s.prospectIds[0])));
    expect(replied.status).toBe('replied');
    const [p] = await getDb().select().from(prospects).where(eq(prospects.id, s.prospectIds[0]));
    expect(p.status).toBe('replied');
    const thread = await s.client.json<{ messages: { direction: string; bodyText: string }[] }>('GET', `/api/inbox/${t.id}`);
    const inbound = thread.body.messages.find((m) => m.direction === 'inbound')!;
    expect(inbound.bodyText).toBe('Yes please!');
    const notes = await s.client.json<{ notifications: { type: string }[] }>('GET', '/api/notifications');
    expect(notes.body.notifications.some((n) => n.type === 'reply')).toBe(true);
  });

  it('continues the sequence after a reply when stop-on-reply is disabled', async () => {
    const s = await setup({ prospects: 1 });
    const id = await createCampaign(s, undefined, { stopOnReply: false });
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    await drain(id);
    const threads = await s.client.json<{ items: { id: string }[] }>('GET', '/api/inbox');
    await s.client.json('POST', `/api/inbox/${threads.body.items[0].id}/simulate-reply`, { body: 'Tell me more' });
    await makeFollowUpsDue(id);
    expect(await drain(id)).toBe(1);
  });

  it('honors unsubscribes across the workspace and cancels pending follow-ups', async () => {
    const s = await setup({ prospects: 1 });
    const id = await createCampaign(s);
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    await drain(id);
    const [msg] = await getDb().select().from(emailMessages).where(eq(emailMessages.campaignId, id));
    const token = /\/u\/(\S+)/.exec(msg.bodyText)![1];
    const res = await app.inject({ method: 'POST', url: `/u/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('You have been unsubscribed');
    const tampered = await app.inject({ method: 'POST', url: `/u/${token.slice(0, -2)}xx` });
    expect(tampered.statusCode).toBe(400);
    const supp = await getDb().select().from(suppressions).where(eq(suppressions.workspaceId, s.workspaceId));
    expect(supp).toHaveLength(1);
    await makeFollowUpsDue(id);
    expect(await drain(id)).toBe(0);
    // A new campaign to the same address skips it.
    const id2 = await createCampaign(s);
    await s.client.json('POST', `/api/campaigns/${id2}/status`, { action: 'start', confirm: true }).catch(() => undefined);
    const readiness = await s.client.json<{ sendable: number; suppressed: number }>('GET', `/api/campaigns/${id2}/readiness`);
    expect(readiness.body.suppressed).toBe(1);
    expect(readiness.body.sendable).toBe(0);
  });

  it('skips recipients without an email address and explains readiness problems', async () => {
    const s = await setup({ prospects: 1, noEmail: 1 });
    const id = await createCampaign(s);
    const r = await s.client.json<{ sendable: number; missingEmail: number; ready: boolean }>('GET', `/api/campaigns/${id}/readiness`);
    expect(r.body).toMatchObject({ sendable: 1, missingEmail: 1, ready: true });
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    expect(await drain(id)).toBe(1);
    const recs = await getDb().select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
    expect(recs.find((x) => x.status === 'skipped')?.stoppedReason).toBe('No email address');
  });

  it('respects the campaign daily limit', async () => {
    const s = await setup({ prospects: 5 });
    const id = await createCampaign(s, undefined, { dailyLimit: 2 });
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    expect(await drain(id)).toBe(2);
    expect(await drain(id)).toBe(0);
  });

  it('pauses with a clear reason at the monthly email limit', async () => {
    const s = await setup({ prospects: 3 });
    await getDb().execute(`update subscriptions set limit_overrides = '{"emails_sent": 2}'::jsonb where workspace_id = '${s.workspaceId}'` as never);
    const id = await createCampaign(s);
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    expect(await drain(id)).toBe(2);
    await sending.processCampaignTick(getDb(), id);
    const c = await s.client.json<{ campaign: { status: string; pauseReason: string } }>('GET', `/api/campaigns/${id}`);
    expect(c.body.campaign.status).toBe('paused');
    expect(c.body.campaign.pauseReason).toMatch(/monthly limit of 2 emails/);
  });

  it('pausing cancels queued emails and resuming continues without duplicates', async () => {
    const s = await setup({ prospects: 2 });
    const id = await createCampaign(s);
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    await sending.processCampaignTick(getDb(), id);
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'pause' });
    const cancelled = await getDb().select().from(emailMessages).where(and(eq(emailMessages.campaignId, id), eq(emailMessages.status, 'cancelled')));
    expect(cancelled).toHaveLength(2);
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'resume', confirm: true });
    // Cancelled messages were never sent, so resuming queues fresh ones exactly once.
    expect(await drain(id)).toBe(2);
    expect(await drain(id)).toBe(0);
    const sent = await getDb().select().from(emailMessages).where(and(eq(emailMessages.campaignId, id), eq(emailMessages.status, 'sent')));
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((m) => m.recipientId)).size).toBe(2);
  });

  it('marks bounces, suppresses the address and stops the recipient', async () => {
    const s = await setup({ prospects: 1 });
    const id = await createCampaign(s);
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    await drain(id);
    const threads = await s.client.json<{ items: { id: string }[] }>('GET', '/api/inbox');
    await s.client.json('POST', `/api/inbox/${threads.body.items[0].id}/simulate-reply`, { body: 'x', bounce: true });
    const [rec] = await getDb().select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
    expect(rec.status).toBe('bounced');
    const c = await s.client.json<{ campaign: { stats: { bounced: number; delivered: number } } }>('GET', `/api/campaigns/${id}`);
    expect(c.body.campaign.stats).toMatchObject({ bounced: 1, delivered: 0 });
  });

  it('sends through the Gmail API with OAuth tokens and threading headers', async () => {
    const s = await setup({ prospects: 1 });
    const [gmail] = await getDb()
      .insert(integrations)
      .values({ workspaceId: s.workspaceId, provider: 'gmail', email: 'sender@gmail.test', status: 'active', scopes: ['https://www.googleapis.com/auth/gmail.send'], accessTokenEnc: encryptSecret('gmail-access-token'), refreshTokenEnc: encryptSecret('gmail-refresh-token'), tokenExpiresAt: new Date(Date.now() + 3600_000), connectedBy: s.userId })
      .returning();
    await getDb().update(integrations).set({ status: 'disconnected' }).where(eq(integrations.id, s.integrationId));
    const id = await createCampaign({ ...s, integrationId: gmail.id });
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    expect(await drain(id)).toBe(1);
    const [m] = await getDb().select().from(emailMessages).where(eq(emailMessages.campaignId, id));
    expect(m.status).toBe('sent');
    expect(m.providerMessageId).toMatch(/^gmail-msg-/);
    // Stored tokens are encrypted, never plain text.
    const [row] = await getDb().select().from(integrations).where(eq(integrations.id, gmail.id));
    expect(row.accessTokenEnc).not.toContain('gmail-access-token');
    expect(row.accessTokenEnc!.startsWith('v1.')).toBe(true);
  });

  it('pauses campaigns and notifies when the mailbox authorization is revoked', async () => {
    const s = await setup({ prospects: 1 });
    const [gmail] = await getDb()
      .insert(integrations)
      .values({ workspaceId: s.workspaceId, provider: 'gmail', email: 'revoked@gmail.test', status: 'active', scopes: [], accessTokenEnc: encryptSecret('revoked-token'), tokenExpiresAt: new Date(Date.now() + 3600_000), connectedBy: s.userId })
      .returning();
    const id = await createCampaign({ ...s, integrationId: gmail.id });
    await s.client.json('POST', `/api/campaigns/${id}/status`, { action: 'start', confirm: true });
    await drain(id);
    const [row] = await getDb().select().from(integrations).where(eq(integrations.id, gmail.id));
    expect(row.status).toBe('error');
    const c = await s.client.json<{ campaign: { status: string } }>('GET', `/api/campaigns/${id}`);
    expect(c.body.campaign.status).toBe('paused');
    const notes = await s.client.json<{ notifications: { type: string }[] }>('GET', '/api/notifications');
    expect(notes.body.notifications.some((n) => n.type === 'integration_disconnected')).toBe(true);
  });

  it('ignores inbound mail unrelated to outreach', async () => {
    const s = await setup({ prospects: 1 });
    const [row] = await getDb().select().from(integrations).where(eq(integrations.id, s.integrationId));
    const r = await inbox.ingestInbound(getDb(), row, { providerMessageId: 'random-1', providerThreadId: 'unknown-thread', messageIdHeader: null, inReplyTo: null, references: [], fromEmail: 'newsletter@random.test', fromName: null, toEmail: row.email, subject: 'Weekly deals', text: 'Buy now', receivedAt: new Date(), isBounce: false, bouncedRecipient: null });
    expect(r).toBe('ignored');
  });
});
