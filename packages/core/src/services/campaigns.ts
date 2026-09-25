import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  campaignRecipients,
  campaignSteps,
  campaigns,
  emailMessages,
  integrations,
  prospects,
  suppressions,
  type DbOrTx,
} from '@localy/database';
import type { CampaignItem, CampaignStats, CampaignStepItem, RecipientItem } from '@localy/shared';
import { AppError, badRequest, conflict, notFound } from '../errors';
import type { WorkspaceContext } from '../context';
import { assertCan } from '../permissions';
import { audit } from '../audit';
import { enqueue, QUEUES } from '../queue';
import { assertActiveSubscription, assertWithinLimit, getUsageItem } from './usage';
import { recordActivities, recordActivity } from './activity';
import { getIntegration } from './integrations';
import { stopSequencesFor } from './prospects';

type CampaignRow = typeof campaigns.$inferSelect;

export interface CampaignInput {
  name: string;
  integrationId?: string | null;
  senderName?: string | null;
  replyTo?: string | null;
  dailyLimit: number;
  startAt?: string | null;
  timezone: string;
  sendWindowStart: number;
  sendWindowEnd: number;
  sendDays: number[];
  stopOnReply: boolean;
  steps: { id?: string; templateId?: string | null; subject: string; body: string; waitDays: number; enabled: boolean }[];
  prospectIds?: string[];
}

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function validateInput(input: CampaignInput) {
  if (!validTimezone(input.timezone)) throw badRequest('Choose a valid timezone.');
  if (input.sendWindowEnd <= input.sendWindowStart) throw badRequest('The sending window must end after it starts.');
  if (!input.steps.some((s) => s.enabled)) throw badRequest('Enable at least one email in the sequence.');
}

export async function getCampaignRow(db: DbOrTx, workspaceId: string, id: string): Promise<CampaignRow> {
  const [c] = await db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, workspaceId))).limit(1);
  if (!c) throw notFound('Campaign');
  return c;
}

export async function getSteps(db: DbOrTx, campaignId: string) {
  return db.select().from(campaignSteps).where(eq(campaignSteps.campaignId, campaignId)).orderBy(asc(campaignSteps.position));
}

function toStepItem(s: typeof campaignSteps.$inferSelect): CampaignStepItem {
  return { id: s.id, position: s.position, templateId: s.templateId, subject: s.subject, body: s.body, waitDays: s.waitDays, enabled: s.enabled };
}

const EMPTY_STATS: CampaignStats = {
  recipients: 0,
  pending: 0,
  queued: 0,
  sent: 0,
  delivered: 0,
  replies: 0,
  positiveReplies: 0,
  followUpsSent: 0,
  unsubscribed: 0,
  bounced: 0,
  failed: 0,
};

export async function campaignStats(db: DbOrTx, campaignIds: string[]): Promise<Map<string, CampaignStats>> {
  const map = new Map<string, CampaignStats>();
  if (!campaignIds.length) return map;
  for (const id of campaignIds) map.set(id, { ...EMPTY_STATS });
  const rec = await db
    .select({
      campaignId: campaignRecipients.campaignId,
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${campaignRecipients.status} in ('pending','in_progress'))::int`,
      replied: sql<number>`count(*) filter (where ${campaignRecipients.repliedAt} is not null)::int`,
      positive: sql<number>`count(*) filter (where ${campaignRecipients.repliedAt} is not null and ${prospects.status} in ('interested','client'))::int`,
      unsubscribed: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'unsubscribed')::int`,
      bounced: sql<number>`count(*) filter (where ${campaignRecipients.status} = 'bounced')::int`,
    })
    .from(campaignRecipients)
    .innerJoin(prospects, eq(prospects.id, campaignRecipients.prospectId))
    .where(inArray(campaignRecipients.campaignId, campaignIds))
    .groupBy(campaignRecipients.campaignId);
  for (const r of rec) {
    const s = map.get(r.campaignId)!;
    s.recipients = r.total;
    s.pending = r.pending;
    s.replies = r.replied;
    s.positiveReplies = r.positive;
    s.unsubscribed = r.unsubscribed;
    s.bounced = r.bounced;
  }
  const msg = await db
    .select({
      campaignId: emailMessages.campaignId,
      sent: sql<number>`count(*) filter (where ${emailMessages.status} in ('sent','bounced'))::int`,
      delivered: sql<number>`count(*) filter (where ${emailMessages.status} = 'sent')::int`,
      queued: sql<number>`count(*) filter (where ${emailMessages.status} in ('queued','sending'))::int`,
      failed: sql<number>`count(*) filter (where ${emailMessages.status} = 'failed')::int`,
      followUps: sql<number>`count(*) filter (where ${emailMessages.status} in ('sent','bounced') and ${emailMessages.stepPosition} > 0)::int`,
    })
    .from(emailMessages)
    .where(and(inArray(emailMessages.campaignId, campaignIds), eq(emailMessages.direction, 'outbound'), eq(emailMessages.isTest, false)))
    .groupBy(emailMessages.campaignId);
  for (const m of msg) {
    if (!m.campaignId) continue;
    const s = map.get(m.campaignId)!;
    s.sent = m.sent;
    s.delivered = m.delivered;
    s.queued = m.queued;
    s.failed = m.failed;
    s.followUpsSent = m.followUps;
  }
  return map;
}

async function toItems(db: DbOrTx, rows: CampaignRow[]): Promise<CampaignItem[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [stats, steps, ints] = await Promise.all([
    campaignStats(db, ids),
    db.select().from(campaignSteps).where(inArray(campaignSteps.campaignId, ids)).orderBy(asc(campaignSteps.position)),
    db
      .select({ id: integrations.id, email: integrations.email, provider: integrations.provider, status: integrations.status })
      .from(integrations)
      .where(inArray(integrations.id, rows.map((r) => r.integrationId).filter(Boolean) as string[])),
  ]);
  const intById = new Map(ints.map((i) => [i.id, i]));
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    integration: c.integrationId ? (intById.get(c.integrationId) ?? null) : null,
    senderName: c.senderName,
    replyTo: c.replyTo,
    dailyLimit: c.dailyLimit,
    startAt: c.startAt?.toISOString() ?? null,
    timezone: c.timezone,
    sendWindowStart: c.sendWindowStart,
    sendWindowEnd: c.sendWindowEnd,
    sendDays: c.sendDays,
    stopOnReply: c.stopOnReply,
    steps: steps.filter((s) => s.campaignId === c.id).map(toStepItem),
    stats: stats.get(c.id) ?? { ...EMPTY_STATS },
    pauseReason: c.pauseReason,
    createdAt: c.createdAt.toISOString(),
    startedAt: c.startedAt?.toISOString() ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
  }));
}

export async function listCampaigns(ctx: WorkspaceContext, opts: { status?: string } = {}): Promise<CampaignItem[]> {
  const conds = [eq(campaigns.workspaceId, ctx.workspaceId)];
  if (opts.status && opts.status !== 'all') conds.push(eq(campaigns.status, opts.status as CampaignRow['status']));
  const rows = await ctx.db.select().from(campaigns).where(and(...conds)).orderBy(desc(campaigns.createdAt)).limit(200);
  return toItems(ctx.db, rows);
}

export async function getCampaign(ctx: WorkspaceContext, id: string): Promise<CampaignItem> {
  const row = await getCampaignRow(ctx.db, ctx.workspaceId, id);
  const [item] = await toItems(ctx.db, [row]);
  return item;
}

async function writeSteps(tx: DbOrTx, campaignId: string, steps: CampaignInput['steps']) {
  await tx.delete(campaignSteps).where(eq(campaignSteps.campaignId, campaignId));
  await tx.insert(campaignSteps).values(
    steps.map((s, i) => ({
      campaignId,
      position: i,
      templateId: s.templateId ?? null,
      subject: s.subject,
      body: s.body,
      waitDays: i === 0 ? 0 : Math.max(1, s.waitDays),
      enabled: i === 0 ? true : s.enabled,
    })),
  );
}

async function assertIntegration(ctx: WorkspaceContext, integrationId: string | null | undefined) {
  if (!integrationId) return null;
  const i = await getIntegration(ctx.db, ctx.workspaceId, integrationId);
  return i;
}

export async function createCampaign(ctx: WorkspaceContext, input: CampaignInput) {
  assertCan(ctx, 'campaigns.write');
  validateInput(input);
  await assertActiveSubscription(ctx.db, ctx.workspaceId);
  await assertIntegration(ctx, input.integrationId);
  const campaign = await ctx.db.transaction(async (tx) => {
    const [c] = await tx
      .insert(campaigns)
      .values({
        workspaceId: ctx.workspaceId,
        name: input.name,
        integrationId: input.integrationId ?? null,
        senderName: input.senderName ?? null,
        replyTo: input.replyTo ?? null,
        dailyLimit: input.dailyLimit,
        startAt: input.startAt ? new Date(input.startAt) : null,
        timezone: input.timezone,
        sendWindowStart: input.sendWindowStart,
        sendWindowEnd: input.sendWindowEnd,
        sendDays: input.sendDays,
        stopOnReply: input.stopOnReply,
        createdBy: ctx.userId,
      })
      .returning();
    await writeSteps(tx, c.id, input.steps);
    return c;
  });
  if (input.prospectIds?.length) await addRecipients(ctx, campaign.id, input.prospectIds);
  await audit(ctx.db, ctx, { action: 'campaign.created', workspaceId: ctx.workspaceId, targetType: 'campaign', targetId: campaign.id, metadata: { name: campaign.name } });
  return getCampaign(ctx, campaign.id);
}

export async function updateCampaign(ctx: WorkspaceContext, id: string, input: CampaignInput) {
  assertCan(ctx, 'campaigns.write');
  validateInput(input);
  const c = await getCampaignRow(ctx.db, ctx.workspaceId, id);
  if (c.status === 'active') throw conflict('Pause the campaign before editing it.');
  if (c.status === 'completed') throw conflict('Completed campaigns cannot be edited. Duplicate it to start a new one.');
  await assertIntegration(ctx, input.integrationId);
  const existingSteps = await getSteps(ctx.db, id);
  const [{ sentAny }] = await ctx.db
    .select({ sentAny: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(and(eq(emailMessages.campaignId, id), eq(emailMessages.status, 'sent')));
  if (sentAny > 0 && input.steps.length < existingSteps.length) {
    throw conflict('Emails from this sequence have already been sent, so steps cannot be removed. Disable them instead.');
  }
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(campaigns)
      .set({
        name: input.name,
        integrationId: input.integrationId ?? null,
        senderName: input.senderName ?? null,
        replyTo: input.replyTo ?? null,
        dailyLimit: input.dailyLimit,
        startAt: input.startAt ? new Date(input.startAt) : null,
        timezone: input.timezone,
        sendWindowStart: input.sendWindowStart,
        sendWindowEnd: input.sendWindowEnd,
        sendDays: input.sendDays,
        stopOnReply: input.stopOnReply,
      })
      .where(eq(campaigns.id, id));
    // Update steps in place to keep positions stable for recipients mid-sequence.
    for (let i = 0; i < input.steps.length; i++) {
      const s = input.steps[i];
      const values = {
        templateId: s.templateId ?? null,
        subject: s.subject,
        body: s.body,
        waitDays: i === 0 ? 0 : Math.max(1, s.waitDays),
        enabled: i === 0 ? true : s.enabled,
      };
      if (existingSteps[i]) await tx.update(campaignSteps).set(values).where(eq(campaignSteps.id, existingSteps[i].id));
      else await tx.insert(campaignSteps).values({ campaignId: id, position: i, ...values });
    }
    if (input.steps.length < existingSteps.length) {
      await tx.delete(campaignSteps).where(and(eq(campaignSteps.campaignId, id), sql`${campaignSteps.position} >= ${input.steps.length}`));
    }
  });
  await audit(ctx.db, ctx, { action: 'campaign.updated', workspaceId: ctx.workspaceId, targetType: 'campaign', targetId: id });
  return getCampaign(ctx, id);
}

export async function duplicateCampaign(ctx: WorkspaceContext, id: string) {
  const c = await getCampaign(ctx, id);
  return createCampaign(ctx, {
    name: `${c.name} (copy)`,
    integrationId: c.integration?.status === 'active' ? c.integration.id : null,
    senderName: c.senderName,
    replyTo: c.replyTo,
    dailyLimit: c.dailyLimit,
    startAt: null,
    timezone: c.timezone,
    sendWindowStart: c.sendWindowStart,
    sendWindowEnd: c.sendWindowEnd,
    sendDays: c.sendDays,
    stopOnReply: c.stopOnReply,
    steps: c.steps.map((s) => ({ templateId: s.templateId, subject: s.subject, body: s.body, waitDays: s.waitDays, enabled: s.enabled })),
  });
}

export async function deleteCampaign(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, 'campaigns.write');
  const c = await getCampaignRow(ctx.db, ctx.workspaceId, id);
  if (c.status === 'active') throw conflict('Pause the campaign before deleting it.');
  await ctx.db.transaction(async (tx) => {
    await tx.update(emailMessages).set({ status: 'cancelled', error: 'Campaign deleted.' }).where(and(eq(emailMessages.campaignId, id), eq(emailMessages.status, 'queued')));
    await tx.delete(campaigns).where(eq(campaigns.id, id));
  });
  await audit(ctx.db, ctx, { action: 'campaign.deleted', workspaceId: ctx.workspaceId, targetType: 'campaign', targetId: id, metadata: { name: c.name } });
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

export async function addRecipients(ctx: WorkspaceContext, campaignId: string, prospectIds: string[]) {
  assertCan(ctx, 'campaigns.write');
  const c = await getCampaignRow(ctx.db, ctx.workspaceId, campaignId);
  if (c.status === 'completed') throw conflict('This campaign is completed. Create a new campaign for these prospects.');
  const valid = await ctx.db
    .select({ id: prospects.id, status: prospects.status })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, ctx.workspaceId), inArray(prospects.id, prospectIds)));
  const eligible = valid.filter((p) => p.status !== 'archived');
  if (!eligible.length) return { added: 0, skipped: prospectIds.length };
  const firstSendAt = c.status === 'active' ? new Date() : (c.startAt ?? new Date());
  const inserted = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(campaignRecipients)
      .values(eligible.map((p) => ({ workspaceId: ctx.workspaceId, campaignId, prospectId: p.id, nextSendAt: firstSendAt })))
      .onConflictDoNothing()
      .returning({ prospectId: campaignRecipients.prospectId });
    await recordActivities(
      tx,
      rows.map((r) => ({ workspaceId: ctx.workspaceId, prospectId: r.prospectId, campaignId, actorId: ctx.userId, type: 'added_to_campaign' as const, data: { campaignName: c.name } })),
    );
    return rows;
  });
  if (c.status === 'active' && inserted.length) await enqueue(QUEUES.campaignTick, { campaignId }, { singletonKey: `tick:${campaignId}` });
  return { added: inserted.length, skipped: prospectIds.length - inserted.length };
}

export async function removeRecipient(ctx: WorkspaceContext, campaignId: string, recipientId: string) {
  assertCan(ctx, 'campaigns.write');
  const c = await getCampaignRow(ctx.db, ctx.workspaceId, campaignId);
  const [r] = await ctx.db
    .select()
    .from(campaignRecipients)
    .where(and(eq(campaignRecipients.id, recipientId), eq(campaignRecipients.campaignId, campaignId)))
    .limit(1);
  if (!r) throw notFound('Recipient');
  await ctx.db.transaction(async (tx) => {
    if (r.pendingMessageId) {
      await tx.update(emailMessages).set({ status: 'cancelled', error: 'Recipient removed.' }).where(and(eq(emailMessages.id, r.pendingMessageId), eq(emailMessages.status, 'queued')));
    }
    await tx.delete(campaignRecipients).where(eq(campaignRecipients.id, recipientId));
    await recordActivity(tx, { workspaceId: ctx.workspaceId, prospectId: r.prospectId, campaignId, actorId: ctx.userId, type: 'removed_from_campaign', data: { campaignName: c.name } });
  });
}

export async function stopRecipientSequence(ctx: WorkspaceContext, prospectId: string, campaignId?: string) {
  assertCan(ctx, 'campaigns.write');
  return ctx.db.transaction((tx) => stopSequencesFor(tx, ctx.workspaceId, [prospectId], 'Stopped manually', ctx.userId, campaignId));
}

export async function listRecipients(ctx: WorkspaceContext, campaignId: string, opts: { page: number; pageSize: number; status?: string }) {
  await getCampaignRow(ctx.db, ctx.workspaceId, campaignId);
  const conds = [eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.workspaceId, ctx.workspaceId)];
  if (opts.status && opts.status !== 'all') conds.push(eq(campaignRecipients.status, opts.status as typeof campaignRecipients.$inferSelect.status));
  const [{ total }] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(campaignRecipients).where(and(...conds));
  const rows = await ctx.db
    .select({ r: campaignRecipients, p: prospects })
    .from(campaignRecipients)
    .innerJoin(prospects, eq(prospects.id, campaignRecipients.prospectId))
    .where(and(...conds))
    .orderBy(asc(campaignRecipients.createdAt))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);
  const supp = await suppressedEmails(ctx.db, ctx.workspaceId, rows.map((x) => x.p.email).filter(Boolean) as string[]);
  const items: RecipientItem[] = rows.map(({ r, p }) => {
    const issues: string[] = [];
    if (!p.email) issues.push('No email address. Add one on the prospect page.');
    else if (supp.has(p.email.toLowerCase())) issues.push('This address has unsubscribed or bounced.');
    return {
      id: r.id,
      prospectId: p.id,
      placeId: p.placeId,
      prospectName: p.name ?? '',
      email: p.email,
      status: r.status,
      currentStep: r.currentStep,
      nextSendAt: r.nextSendAt?.toISOString() ?? null,
      lastSentAt: r.lastSentAt?.toISOString() ?? null,
      repliedAt: r.repliedAt?.toISOString() ?? null,
      stoppedReason: r.stoppedReason,
      issues,
    };
  });
  return { items, total, page: opts.page, pageSize: opts.pageSize };
}

export async function suppressedEmails(db: DbOrTx, workspaceId: string, emails: string[]) {
  const set = new Set<string>();
  if (!emails.length) return set;
  const rows = await db
    .select({ email: suppressions.email })
    .from(suppressions)
    .where(and(eq(suppressions.workspaceId, workspaceId), inArray(sql`lower(${suppressions.email})`, emails.map((e) => e.toLowerCase()))));
  for (const r of rows) set.add(r.email.toLowerCase());
  return set;
}

/** Summarizes who will actually receive email, for the confirmation step. */
export async function readiness(ctx: WorkspaceContext, campaignId: string) {
  const c = await getCampaignRow(ctx.db, ctx.workspaceId, campaignId);
  const rows = await ctx.db
    .select({ status: campaignRecipients.status, email: prospects.email, unsubscribedAt: prospects.unsubscribedAt })
    .from(campaignRecipients)
    .innerJoin(prospects, eq(prospects.id, campaignRecipients.prospectId))
    .where(eq(campaignRecipients.campaignId, campaignId));
  const pendingRows = rows.filter((r) => r.status === 'pending' || r.status === 'in_progress');
  const supp = await suppressedEmails(ctx.db, ctx.workspaceId, pendingRows.map((r) => r.email).filter(Boolean) as string[]);
  const missingEmail = pendingRows.filter((r) => !r.email).length;
  const suppressed = pendingRows.filter((r) => r.email && (supp.has(r.email.toLowerCase()) || r.unsubscribedAt)).length;
  const sendable = pendingRows.length - missingEmail - suppressed;
  const steps = await getSteps(ctx.db, campaignId);
  const problems: string[] = [];
  if (!c.integrationId) problems.push('Choose a mailbox to send from.');
  else {
    const [i] = await ctx.db.select().from(integrations).where(eq(integrations.id, c.integrationId));
    if (i?.status !== 'active') problems.push('The selected mailbox needs to be reconnected.');
  }
  if (!steps.some((s) => s.enabled)) problems.push('Add at least one email to the sequence.');
  if (sendable === 0) problems.push('No recipients can be emailed yet. Add email addresses to your prospects.');
  const emails = await getUsageItem(ctx.db, ctx.workspaceId, 'emails_sent');
  const remainingMonthly = Math.max(0, emails.limit - emails.used);
  const enabledSteps = steps.filter((s) => s.enabled).length;
  return {
    total: rows.length,
    sendable,
    missingEmail,
    suppressed,
    enabledSteps,
    maxEmails: sendable * enabledSteps,
    remainingMonthly,
    willExceedMonthly: sendable > remainingMonthly,
    problems,
    ready: problems.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function startCampaign(ctx: WorkspaceContext, id: string, opts: { confirm: boolean }) {
  assertCan(ctx, 'campaigns.write');
  const c = await getCampaignRow(ctx.db, ctx.workspaceId, id);
  if (!opts.confirm) throw badRequest('Confirm that you want to start sending.');
  if (!['draft', 'paused', 'scheduled'].includes(c.status)) throw conflict(`This campaign is ${c.status} and cannot be started.`);
  const r = await readiness(ctx, id);
  if (!r.ready) throw new AppError('BAD_REQUEST', r.problems[0], { details: { problems: r.problems } });
  if (c.status === 'draft') await assertWithinLimit(ctx.db, ctx.workspaceId, 'active_campaigns', 1);
  else await assertActiveSubscription(ctx.db, ctx.workspaceId);
  const scheduled = c.status === 'draft' && c.startAt && c.startAt.getTime() > Date.now();
  const now = new Date();
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(campaigns)
      .set({ status: scheduled ? 'scheduled' : 'active', pauseReason: null, startedAt: c.startedAt ?? (scheduled ? null : now) })
      .where(eq(campaigns.id, id));
    if (!scheduled) {
      // Recipients waiting for the first email become due now.
      await tx
        .update(campaignRecipients)
        .set({ nextSendAt: now })
        .where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, 'pending'), sql`(${campaignRecipients.nextSendAt} is null or ${campaignRecipients.nextSendAt} > now())`));
    } else {
      await tx.update(campaignRecipients).set({ nextSendAt: c.startAt }).where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, 'pending')));
    }
    await recordActivity(tx, { workspaceId: ctx.workspaceId, campaignId: id, actorId: ctx.userId, type: c.status === 'paused' ? 'campaign_resumed' : 'campaign_started', data: { campaignName: c.name, scheduled: Boolean(scheduled) } });
  });
  await audit(ctx.db, ctx, {
    action: scheduled ? 'campaign.scheduled' : c.status === 'paused' ? 'campaign.resumed' : 'campaign.started',
    workspaceId: ctx.workspaceId,
    targetType: 'campaign',
    targetId: id,
    metadata: { sendable: r.sendable, startAt: c.startAt?.toISOString() ?? null },
  });
  if (!scheduled) await enqueue(QUEUES.campaignTick, { campaignId: id }, { singletonKey: `tick:${id}` });
  return getCampaign(ctx, id);
}

export async function pauseCampaign(ctx: WorkspaceContext, id: string, reason?: string) {
  assertCan(ctx, 'campaigns.write');
  const c = await getCampaignRow(ctx.db, ctx.workspaceId, id);
  if (!['active', 'scheduled'].includes(c.status)) throw conflict('Only active or scheduled campaigns can be paused.');
  await ctx.db.transaction(async (tx) => {
    await tx.update(campaigns).set({ status: 'paused', pauseReason: reason ?? null }).where(eq(campaigns.id, id));
    await cancelQueuedForCampaign(tx, id, 'Campaign paused before this email was sent.');
    await recordActivity(tx, { workspaceId: ctx.workspaceId, campaignId: id, actorId: ctx.userId, type: 'campaign_paused', data: { campaignName: c.name } });
  });
  await audit(ctx.db, ctx, { action: 'campaign.paused', workspaceId: ctx.workspaceId, targetType: 'campaign', targetId: id });
  return getCampaign(ctx, id);
}

export async function cancelQueuedForCampaign(tx: DbOrTx, campaignId: string, reason: string) {
  const cancelled = await tx
    .update(emailMessages)
    .set({ status: 'cancelled', error: reason })
    .where(and(eq(emailMessages.campaignId, campaignId), eq(emailMessages.status, 'queued')))
    .returning({ id: emailMessages.id });
  if (cancelled.length) {
    await tx
      .update(campaignRecipients)
      .set({ pendingMessageId: null })
      .where(and(eq(campaignRecipients.campaignId, campaignId), inArray(campaignRecipients.pendingMessageId, cancelled.map((m) => m.id))));
  }
  return cancelled.length;
}

export async function completeCampaign(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, 'campaigns.write');
  const c = await getCampaignRow(ctx.db, ctx.workspaceId, id);
  if (c.status === 'completed') return getCampaign(ctx, id);
  await ctx.db.transaction(async (tx) => {
    await cancelQueuedForCampaign(tx, id, 'Campaign ended before this email was sent.');
    await tx
      .update(campaignRecipients)
      .set({ status: 'stopped', stoppedReason: 'Campaign ended', nextSendAt: null })
      .where(and(eq(campaignRecipients.campaignId, id), inArray(campaignRecipients.status, ['pending', 'in_progress'])));
    await tx.update(campaigns).set({ status: 'completed', completedAt: new Date() }).where(eq(campaigns.id, id));
    await recordActivity(tx, { workspaceId: ctx.workspaceId, campaignId: id, actorId: ctx.userId, type: 'campaign_completed', data: { campaignName: c.name, manual: true } });
  });
  await audit(ctx.db, ctx, { action: 'campaign.completed', workspaceId: ctx.workspaceId, targetType: 'campaign', targetId: id });
  return getCampaign(ctx, id);
}

// ---------------------------------------------------------------------------
// Composer quick send
// ---------------------------------------------------------------------------

/**
 * The composer sends through the same queue as campaigns: it creates a
 * one-off "quick send" campaign (visible under Campaigns) so every email gets
 * duplicate protection, retries, follow-up scheduling and reply detection.
 * The idempotency key makes a repeated submit return the existing send.
 */
export async function composeAndSend(
  ctx: WorkspaceContext,
  input: {
    prospectIds: string[];
    integrationId: string;
    subject: string;
    body: string;
    scheduledFor?: string | null;
    followUps: { subject: string; body: string; waitDays: number }[];
    idempotencyKey: string;
    campaignName?: string | null;
  },
) {
  assertCan(ctx, 'campaigns.write');
  const [existing] = await ctx.db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, ctx.workspaceId), eq(campaigns.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (existing) return { campaign: await getCampaign(ctx, existing.id), duplicate: true };
  const integration = await getIntegration(ctx.db, ctx.workspaceId, input.integrationId);
  if (integration.status !== 'active') throw new AppError('INTEGRATION_DISCONNECTED', `Reconnect ${integration.email} before sending.`);
  await assertWithinLimit(ctx.db, ctx.workspaceId, 'active_campaigns', 1);
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  if (scheduledFor && scheduledFor.getTime() < Date.now() - 60_000) throw badRequest('Choose a time in the future.');
  const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(scheduledFor ?? new Date());
  const [ws] = await ctx.db.query.workspaces.findMany({ where: (w, { eq: e }) => e(w.id, ctx.workspaceId), limit: 1 });
  let campaignId: string;
  try {
    campaignId = await ctx.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(campaigns)
        .values({
          workspaceId: ctx.workspaceId,
          name: input.campaignName || `Quick send, ${label}`,
          kind: 'quick',
          status: 'draft',
          integrationId: integration.id,
          dailyLimit: Math.max(1, integration.dailySendLimit),
          startAt: scheduledFor,
          timezone: 'UTC',
          sendWindowStart: 0,
          sendWindowEnd: 24,
          sendDays: [1, 2, 3, 4, 5, 6, 7],
          stopOnReply: true,
          senderName: (ws?.settings as { defaultSenderName?: string } | undefined)?.defaultSenderName ?? null,
          createdBy: ctx.userId,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      await writeSteps(tx, c.id, [
        { subject: input.subject, body: input.body, waitDays: 0, enabled: true },
        ...input.followUps.map((f) => ({ subject: f.subject, body: f.body, waitDays: f.waitDays, enabled: true })),
      ]);
      return c.id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      const [again] = await ctx.db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.workspaceId, ctx.workspaceId), eq(campaigns.idempotencyKey, input.idempotencyKey)));
      if (again) return { campaign: await getCampaign(ctx, again.id), duplicate: true };
    }
    throw err;
  }
  await addRecipients(ctx, campaignId, input.prospectIds);
  await audit(ctx.db, ctx, { action: 'campaign.created', workspaceId: ctx.workspaceId, targetType: 'campaign', targetId: campaignId, metadata: { kind: 'quick' } });
  const campaign = await startCampaign(ctx, campaignId, { confirm: true });
  return { campaign, duplicate: false };
}

export async function campaignOptions(ctx: WorkspaceContext) {
  const rows = await ctx.db
    .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, ctx.workspaceId), notInArray(campaigns.status, ['completed'])))
    .orderBy(desc(campaigns.createdAt));
  return rows;
}

