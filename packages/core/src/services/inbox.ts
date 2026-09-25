import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  campaignRecipients,
  campaigns,
  emailEvents,
  emailMessages,
  emailThreads,
  integrations,
  prospects,
  suppressions,
  type Database,
  type DbOrTx,
} from '@localy/database';
import { getProvider, stripQuotedText, type InboundMessage } from '@localy/email';
import type { MessageItem, ProspectStatus, ThreadItem } from '@localy/shared';
import { AppError, badRequest, forbidden, notFound } from '../errors';
import type { WorkspaceContext } from '../context';
import { assertCan } from '../permissions';
import { verifyUnsubscribeToken } from '../crypto';
import { logger } from '../logger';
import { audit } from '../audit';
import { recordActivity } from './activity';
import { getFreshCredentials } from './integrations';
import { notifyWorkspace } from './notifications';
import { stopSequencesFor } from './prospects';
import { processSendEmail } from './sending';
import { assertActiveSubscription } from './usage';
import { senderContext } from './personalization';

type ThreadRow = typeof emailThreads.$inferSelect;
type MessageRow = typeof emailMessages.$inferSelect;

function toMessageItem(m: MessageRow): MessageItem {
  return {
    id: m.id,
    direction: m.direction,
    status: m.status,
    fromEmail: m.fromEmail,
    fromName: m.fromName,
    toEmail: m.toEmail,
    subject: m.subject,
    bodyText: m.bodyText,
    sentAt: m.sentAt?.toISOString() ?? null,
    receivedAt: m.receivedAt?.toISOString() ?? null,
    scheduledFor: m.scheduledFor?.toISOString() ?? null,
    error: m.error,
    campaignId: m.campaignId,
    stepPosition: m.stepPosition,
    isTest: m.isTest,
    createdAt: m.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Inbound processing (shared by provider sync and the development simulator)
// ---------------------------------------------------------------------------

async function findThreadForInbound(db: DbOrTx, integrationId: string, workspaceId: string, msg: InboundMessage): Promise<ThreadRow | null> {
  if (msg.providerThreadId) {
    const [t] = await db
      .select()
      .from(emailThreads)
      .where(and(eq(emailThreads.integrationId, integrationId), eq(emailThreads.providerThreadId, msg.providerThreadId)))
      .limit(1);
    if (t) return t;
  }
  const refs = [msg.inReplyTo, ...msg.references].filter(Boolean) as string[];
  if (refs.length) {
    const [m] = await db
      .select({ threadId: emailMessages.threadId })
      .from(emailMessages)
      .where(and(eq(emailMessages.workspaceId, workspaceId), inArray(emailMessages.messageIdHeader, refs)))
      .limit(1);
    if (m?.threadId) {
      const [t] = await db.select().from(emailThreads).where(eq(emailThreads.id, m.threadId));
      if (t) return t;
    }
  }
  // Fall back to the most recent thread with a prospect using this address.
  const [t] = await db
    .select({ t: emailThreads })
    .from(emailThreads)
    .innerJoin(prospects, eq(prospects.id, emailThreads.prospectId))
    .where(and(eq(emailThreads.workspaceId, workspaceId), eq(emailThreads.integrationId, integrationId), sql`lower(${prospects.email}) = ${msg.fromEmail.toLowerCase()}`))
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(1);
  return t?.t ?? null;
}

async function handleBounce(db: Database, integration: typeof integrations.$inferSelect, msg: InboundMessage) {
  const recipient = msg.bouncedRecipient?.toLowerCase();
  if (!recipient) return false;
  const [original] = await db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.integrationId, integration.id), eq(emailMessages.direction, 'outbound'), eq(emailMessages.status, 'sent'), sql`lower(${emailMessages.toEmail}) = ${recipient}`))
    .orderBy(desc(emailMessages.sentAt))
    .limit(1);
  if (!original) return false;
  await db.transaction(async (tx) => {
    await tx.update(emailMessages).set({ status: 'bounced', error: 'The recipient mail server reported that this message could not be delivered.' }).where(eq(emailMessages.id, original.id));
    await tx.insert(emailEvents).values({ workspaceId: original.workspaceId, messageId: original.id, campaignId: original.campaignId, prospectId: original.prospectId, type: 'bounced', stepPosition: original.stepPosition });
    await tx.insert(suppressions).values({ workspaceId: original.workspaceId, email: recipient, reason: 'bounced' }).onConflictDoNothing();
    if (original.recipientId) {
      await tx.update(campaignRecipients).set({ status: 'bounced', stoppedReason: 'Email bounced', nextSendAt: null }).where(eq(campaignRecipients.id, original.recipientId));
    }
    if (original.prospectId) {
      await recordActivity(tx, { workspaceId: original.workspaceId, prospectId: original.prospectId, campaignId: original.campaignId, type: 'email_bounced', data: { email: recipient } });
    }
  });
  return true;
}

/**
 * Records an inbound email, links it to the conversation and prospect, and
 * stops follow-ups when the campaign is configured to stop on reply.
 */
export async function ingestInbound(db: Database, integration: typeof integrations.$inferSelect, msg: InboundMessage): Promise<'recorded' | 'duplicate' | 'bounce' | 'ignored'> {
  const [dupe] = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(and(eq(emailMessages.integrationId, integration.id), eq(emailMessages.providerMessageId, msg.providerMessageId)))
    .limit(1);
  if (dupe) return 'duplicate';
  if (msg.isBounce) return (await handleBounce(db, integration, msg)) ? 'bounce' : 'ignored';

  const thread = await findThreadForInbound(db, integration.id, integration.workspaceId, msg);
  if (!thread) return 'ignored'; // Only replies to Localy outreach are tracked.

  const receivedAt = msg.receivedAt;
  const body = stripQuotedText(msg.text) || msg.text.trim();
  let notifiedProspect: { id: string; name: string | null } | null = null;
  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(emailMessages)
      .values({
        workspaceId: integration.workspaceId,
        threadId: thread.id,
        integrationId: integration.id,
        prospectId: thread.prospectId,
        campaignId: thread.campaignId,
        direction: 'inbound',
        status: 'received',
        providerMessageId: msg.providerMessageId,
        messageIdHeader: msg.messageIdHeader,
        inReplyTo: msg.inReplyTo,
        fromEmail: msg.fromEmail,
        fromName: msg.fromName,
        toEmail: msg.toEmail ?? integration.email,
        subject: msg.subject,
        bodyText: body.slice(0, 50_000),
        receivedAt,
      })
      .onConflictDoNothing()
      .returning({ id: emailMessages.id });
    if (!inserted.length) return 'duplicate' as const;
    await tx
      .update(emailThreads)
      .set({ lastMessageAt: receivedAt, lastDirection: 'inbound', lastPreview: body.slice(0, 160), unread: true, status: 'open', ...(msg.providerThreadId && !thread.providerThreadId ? { providerThreadId: msg.providerThreadId } : {}) })
      .where(eq(emailThreads.id, thread.id));
    if (thread.prospectId) {
      const [p] = await tx.select().from(prospects).where(eq(prospects.id, thread.prospectId));
      if (p) {
        const promote: ProspectStatus[] = ['new', 'contacted', 'follow_up'];
        await tx
          .update(prospects)
          .set({ lastReplyAt: receivedAt, status: promote.includes(p.status) ? 'replied' : p.status })
          .where(eq(prospects.id, p.id));
        await recordActivity(tx, { workspaceId: integration.workspaceId, prospectId: p.id, campaignId: thread.campaignId, type: 'reply_received', data: { subject: msg.subject, messageId: inserted[0].id } });
        if (promote.includes(p.status)) {
          await recordActivity(tx, { workspaceId: integration.workspaceId, prospectId: p.id, type: 'status_changed', data: { from: p.status, to: 'replied', automatic: true } });
        }
        // Mark recipients as replied; stop sequences where configured.
        const recs = await tx
          .select({ r: campaignRecipients, stopOnReply: campaigns.stopOnReply })
          .from(campaignRecipients)
          .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
          .where(and(eq(campaignRecipients.prospectId, p.id), eq(campaignRecipients.workspaceId, integration.workspaceId)));
        const toStop: string[] = [];
        for (const { r, stopOnReply } of recs) {
          if (!r.repliedAt) await tx.update(campaignRecipients).set({ repliedAt: receivedAt }).where(eq(campaignRecipients.id, r.id));
          if (stopOnReply && ['pending', 'in_progress'].includes(r.status)) toStop.push(r.campaignId);
        }
        for (const campaignId of toStop) {
          await stopSequencesFor(tx, integration.workspaceId, [p.id], 'Replied', null, campaignId);
          await tx
            .update(campaignRecipients)
            .set({ status: 'replied' })
            .where(and(eq(campaignRecipients.prospectId, p.id), eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, 'stopped')));
        }
        await tx.insert(emailEvents).values({ workspaceId: integration.workspaceId, messageId: inserted[0].id, campaignId: thread.campaignId, prospectId: p.id, type: 'replied' });
        notifiedProspect = { id: p.id, name: p.name };
      }
    }
    return 'recorded' as const;
  });
  if (result === 'recorded') {
    const np = notifiedProspect as { id: string; name: string | null } | null;
    await notifyWorkspace(db, integration.workspaceId, {
      type: 'reply',
      title: `New reply${np?.name ? ` from ${np.name}` : ''}`,
      body: body.slice(0, 180),
      link: `/app/inbox/${thread.id}`,
      dedupeKey: `reply:${msg.providerMessageId}`,
    });
  }
  return result;
}

export async function syncIntegrationInbox(db: Database, integrationId: string) {
  const [i] = await db.select().from(integrations).where(eq(integrations.id, integrationId));
  if (!i || i.status !== 'active' || i.provider === 'sandbox') return { processed: 0 };
  const provider = getProvider(i.provider);
  const since = i.lastSyncedAt ? new Date(i.lastSyncedAt.getTime() - 10 * 60_000) : new Date(Date.now() - 3 * 24 * 60 * 60_000);
  const creds = await getFreshCredentials(db, i);
  const res = await provider.sync(creds, since);
  let processed = 0;
  for (const msg of res.messages) {
    try {
      const r = await ingestInbound(db, i, msg);
      if (r === 'recorded' || r === 'bounce') processed++;
    } catch (err) {
      logger.error({ err, integrationId }, 'failed to ingest inbound message');
    }
  }
  await db.update(integrations).set({ lastSyncedAt: new Date(), syncCursor: res.nextCursor ?? i.syncCursor }).where(eq(integrations.id, i.id));
  return { processed };
}

// ---------------------------------------------------------------------------
// Inbox API
// ---------------------------------------------------------------------------

export async function listThreads(ctx: WorkspaceContext, opts: { status?: 'open' | 'archived' | 'all'; filter?: 'all' | 'replied' | 'unread'; q?: string; page: number; pageSize: number }) {
  const conds = [eq(emailThreads.workspaceId, ctx.workspaceId)];
  if (opts.status && opts.status !== 'all') conds.push(eq(emailThreads.status, opts.status));
  if (opts.filter === 'unread') conds.push(eq(emailThreads.unread, true));
  if (opts.filter === 'replied') conds.push(sql`exists (select 1 from ${emailMessages} where ${emailMessages.threadId} = ${emailThreads.id} and ${emailMessages.direction} = 'inbound')`);
  if (opts.q) {
    const term = `%${opts.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(emailThreads.subject, term), ilike(prospects.name, term), ilike(prospects.email, term))!);
  }
  const where = and(...conds);
  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(emailThreads)
    .leftJoin(prospects, eq(prospects.id, emailThreads.prospectId))
    .where(where);
  const rows = await ctx.db
    .select({
      t: emailThreads,
      prospectName: prospects.name,
      placeId: prospects.placeId,
      prospectStatus: prospects.status,
      campaignName: campaigns.name,
      provider: integrations.provider,
      messageCount: sql<number>`(select count(*)::int from ${emailMessages} where ${emailMessages.threadId} = ${emailThreads.id} and ${emailMessages.status} in ('sent','received','bounced'))`,
    })
    .from(emailThreads)
    .leftJoin(prospects, eq(prospects.id, emailThreads.prospectId))
    .leftJoin(campaigns, eq(campaigns.id, emailThreads.campaignId))
    .leftJoin(integrations, eq(integrations.id, emailThreads.integrationId))
    .where(where)
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);
  const items: ThreadItem[] = rows.map((r) => ({
    id: r.t.id,
    prospectId: r.t.prospectId,
    placeId: r.placeId ?? null,
    prospectName: r.prospectName ?? '',
    prospectStatus: r.prospectStatus ?? null,
    subject: r.t.subject,
    lastMessageAt: r.t.lastMessageAt.toISOString(),
    lastMessagePreview: r.t.lastPreview,
    lastDirection: r.t.lastDirection,
    status: r.t.status,
    unread: r.t.unread,
    campaignId: r.t.campaignId,
    campaignName: r.campaignName ?? null,
    integrationProvider: r.provider ?? null,
    messageCount: r.messageCount,
  }));
  return { items, total, page: opts.page, pageSize: opts.pageSize };
}

async function getThreadRow(ctx: WorkspaceContext, id: string) {
  const [t] = await ctx.db.select().from(emailThreads).where(and(eq(emailThreads.id, id), eq(emailThreads.workspaceId, ctx.workspaceId))).limit(1);
  if (!t) throw notFound('Conversation');
  return t;
}

export async function getThread(ctx: WorkspaceContext, id: string) {
  const t = await getThreadRow(ctx, id);
  if (t.unread) await ctx.db.update(emailThreads).set({ unread: false }).where(eq(emailThreads.id, id));
  const messages = await ctx.db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, id), eq(emailMessages.workspaceId, ctx.workspaceId)))
    .orderBy(asc(sql`coalesce(${emailMessages.sentAt}, ${emailMessages.receivedAt}, ${emailMessages.createdAt})`));
  const [integration] = t.integrationId ? await ctx.db.select().from(integrations).where(eq(integrations.id, t.integrationId)) : [undefined];
  const [campaign] = t.campaignId ? await ctx.db.select({ id: campaigns.id, name: campaigns.name, status: campaigns.status }).from(campaigns).where(eq(campaigns.id, t.campaignId)) : [undefined];
  return {
    thread: { id: t.id, subject: t.subject, status: t.status, prospectId: t.prospectId, campaignId: t.campaignId, lastMessageAt: t.lastMessageAt.toISOString() },
    messages: messages.map(toMessageItem),
    integration: integration ? { id: integration.id, email: integration.email, provider: integration.provider, status: integration.status } : null,
    campaign: campaign ?? null,
  };
}

export async function setThreadStatus(ctx: WorkspaceContext, id: string, status: 'open' | 'archived') {
  assertCan(ctx, 'inbox.write');
  await getThreadRow(ctx, id);
  await ctx.db.update(emailThreads).set({ status, unread: false }).where(eq(emailThreads.id, id));
}

export async function markThreadUnread(ctx: WorkspaceContext, id: string) {
  await getThreadRow(ctx, id);
  await ctx.db.update(emailThreads).set({ unread: true }).where(eq(emailThreads.id, id));
}

/** Sends a manual reply in an existing conversation through the same mailbox. */
export async function replyToThread(ctx: WorkspaceContext, id: string, body: string) {
  assertCan(ctx, 'inbox.write');
  await assertActiveSubscription(ctx.db, ctx.workspaceId);
  const t = await getThreadRow(ctx, id);
  if (!t.integrationId) throw badRequest('This conversation has no mailbox.');
  const [integration] = await ctx.db.select().from(integrations).where(eq(integrations.id, t.integrationId));
  if (!integration || integration.status !== 'active') throw new AppError('INTEGRATION_DISCONNECTED', 'Reconnect the mailbox for this conversation before replying.');
  const [lastInbound] = await ctx.db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, id), eq(emailMessages.direction, 'inbound')))
    .orderBy(desc(emailMessages.receivedAt))
    .limit(1);
  const [prospect] = t.prospectId ? await ctx.db.select().from(prospects).where(eq(prospects.id, t.prospectId)) : [undefined];
  const to = lastInbound?.fromEmail ?? prospect?.email;
  if (!to) throw badRequest('There is no address to reply to.');
  const sender = await senderContext(ctx.db, ctx.workspaceId, { userId: ctx.userId });
  const subject = t.subject.toLowerCase().startsWith('re:') ? t.subject : `Re: ${t.subject}`;
  const [m] = await ctx.db
    .insert(emailMessages)
    .values({
      workspaceId: ctx.workspaceId,
      threadId: id,
      integrationId: integration.id,
      prospectId: t.prospectId,
      campaignId: null,
      direction: 'outbound',
      status: 'queued',
      fromEmail: integration.email,
      fromName: sender.senderName,
      toEmail: to,
      subject,
      bodyText: body,
      createdBy: ctx.userId,
    })
    .returning();
  // Manual replies are personal responses and do not carry the outreach footer.
  const result = await processSendEmail(ctx.db, m.id);
  if (result.status !== 'sent') {
    const [failed] = await ctx.db.select({ error: emailMessages.error }).from(emailMessages).where(eq(emailMessages.id, m.id));
    throw new AppError('INTEGRATION_ERROR', failed?.error ?? 'The reply could not be sent.');
  }
  await audit(ctx.db, ctx, { action: 'email.reply_sent', workspaceId: ctx.workspaceId, targetType: 'thread', targetId: id });
  return { messageId: m.id };
}

/**
 * Development tool: records a simulated inbound reply for a sandbox mailbox so
 * the reply workflow can be exercised without a real provider.
 */
export async function simulateReply(ctx: WorkspaceContext, threadId: string, body: string, bounce = false) {
  const t = await getThreadRow(ctx, threadId);
  const [integration] = t.integrationId ? await ctx.db.select().from(integrations).where(eq(integrations.id, t.integrationId)) : [undefined];
  if (!integration || integration.provider !== 'sandbox') throw forbidden('Replies can only be simulated for development sandbox mailboxes.');
  const [lastOut] = await ctx.db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, threadId), eq(emailMessages.direction, 'outbound'), eq(emailMessages.status, 'sent')))
    .orderBy(desc(emailMessages.sentAt))
    .limit(1);
  if (!lastOut) throw badRequest('Send an email in this conversation first.');
  const msg: InboundMessage = {
    providerMessageId: `sandbox-in-${crypto.randomUUID()}`,
    providerThreadId: t.providerThreadId,
    messageIdHeader: `<sandbox-${crypto.randomUUID()}@sandbox.local>`,
    inReplyTo: lastOut.messageIdHeader,
    references: lastOut.messageIdHeader ? [lastOut.messageIdHeader] : [],
    fromEmail: bounce ? 'mailer-daemon@sandbox.local' : lastOut.toEmail,
    fromName: null,
    toEmail: integration.email,
    subject: bounce ? 'Delivery Status Notification (Failure)' : `Re: ${lastOut.subject}`,
    text: bounce ? `Delivery to ${lastOut.toEmail} failed permanently.` : body,
    receivedAt: new Date(),
    isBounce: bounce,
    bouncedRecipient: bounce ? lastOut.toEmail : null,
  };
  return ingestInbound(ctx.db, integration, msg);
}

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------

export async function unsubscribeByToken(db: Database, token: string) {
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) return { ok: false as const };
  const payload = { w: parsed.workspaceId, e: parsed.email, p: parsed.prospectId };
  await db.transaction(async (tx) => {
    await tx.insert(suppressions).values({ workspaceId: payload.w, email: payload.e.toLowerCase(), reason: 'unsubscribed' }).onConflictDoNothing();
    const matching = await tx
      .update(prospects)
      .set({ unsubscribedAt: new Date() })
      .where(and(eq(prospects.workspaceId, payload.w), sql`lower(${prospects.email}) = ${payload.e.toLowerCase()}`))
      .returning({ id: prospects.id });
    const ids = matching.map((m) => m.id);
    if (ids.length) {
      await stopSequencesFor(tx, payload.w, ids, 'Unsubscribed', null);
      await tx
        .update(campaignRecipients)
        .set({ status: 'unsubscribed' })
        .where(and(inArray(campaignRecipients.prospectId, ids), eq(campaignRecipients.status, 'stopped'), eq(campaignRecipients.stoppedReason, 'Unsubscribed')));
      for (const id of ids) {
        await recordActivity(tx, { workspaceId: payload.w, prospectId: id, type: 'unsubscribed', data: {} });
        await tx.insert(emailEvents).values({ workspaceId: payload.w, prospectId: id, type: 'unsubscribed' });
      }
    }
  });
  return { ok: true as const, email: payload.e };
}
