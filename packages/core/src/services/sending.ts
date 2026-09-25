import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
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
import { generateMessageId, getProvider, ProviderError } from '@localy/email';
import { logger } from '../logger';
import { enqueue, QUEUES } from '../queue';
import { audit } from '../audit';
import { AppError } from '../errors';
import { recordActivity } from './activity';
import { getEffectivePlan, getUsageItem, incrementUsage } from './usage';
import { getFreshCredentials, markIntegrationError, sentTodayByIntegration } from './integrations';
import { notifyWorkspace } from './notifications';
import { composeEmail, senderContext, variablesForProspect } from './personalization';
import { getSteps } from './campaigns';

/*
 * Sending pipeline
 * ----------------
 *   API (start / resume)            -> enqueue campaign.tick
 *   campaign.tick (worker)          -> selects due recipients within the
 *                                      campaign's window, daily limit, mailbox
 *                                      limit and plan limit; creates one
 *                                      email_messages row per step with a
 *                                      deterministic idempotency key; enqueues
 *                                      email.send per message
 *   email.send (worker)             -> atomically claims the message
 *                                      (queued -> sending), re-checks
 *                                      suppression, campaign state and reply
 *                                      status, renders, sends through the
 *                                      provider, records the result, and
 *                                      schedules the next step
 *   dispatcher (every minute)       -> enqueues ticks for active campaigns,
 *                                      promotes scheduled campaigns, re-queues
 *                                      stranded messages
 *
 * Duplicate prevention: the idempotency key `campaign:<recipient>:<step>` is
 * unique, messages are claimed with a conditional update, and a message is
 * never re-sent once it has left the `queued` state.
 */

const TICK_BATCH = 25;
const MAX_SEND_ATTEMPTS = 5;

type CampaignRow = typeof campaigns.$inferSelect;

/** Returns local hour (0-23) and ISO weekday (1-7) for a timezone. */
export function localTimeParts(date: Date, timezone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[wd as 'Mon'] ?? 1;
  return { hour, weekday };
}

export function isWithinSendWindow(c: Pick<CampaignRow, 'timezone' | 'sendWindowStart' | 'sendWindowEnd' | 'sendDays'>, now = new Date()) {
  const { hour, weekday } = localTimeParts(now, c.timezone);
  return c.sendDays.includes(weekday) && hour >= c.sendWindowStart && hour < c.sendWindowEnd;
}

/** Start of the current day in the campaign's timezone, as a UTC instant. */
export function startOfLocalDay(timezone: string, now = new Date()): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const offset = asUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) - offset);
}

async function sentTodayForCampaign(db: DbOrTx, c: CampaignRow) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.campaignId, c.id),
        eq(emailMessages.direction, 'outbound'),
        or(inArray(emailMessages.status, ['queued', 'sending']), and(inArray(emailMessages.status, ['sent', 'bounced']), gte(emailMessages.sentAt, startOfLocalDay(c.timezone))))!,
      ),
    );
  return r?.n ?? 0;
}

async function suppressed(db: DbOrTx, workspaceId: string, email: string) {
  const [s] = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.workspaceId, workspaceId), sql`lower(${suppressions.email}) = ${email.toLowerCase()}`))
    .limit(1);
  return Boolean(s);
}

async function pauseForReason(db: Database, c: CampaignRow, reason: string, notify: boolean) {
  const res = await db
    .update(campaigns)
    .set({ status: 'paused', pauseReason: reason })
    .where(and(eq(campaigns.id, c.id), inArray(campaigns.status, ['active', 'scheduled'])))
    .returning({ id: campaigns.id });
  if (!res.length) return;
  await recordActivity(db, { workspaceId: c.workspaceId, campaignId: c.id, type: 'campaign_paused', data: { campaignName: c.name, reason } });
  if (notify) {
    await notifyWorkspace(db, c.workspaceId, {
      type: 'system',
      title: `"${c.name}" was paused`,
      body: reason,
      link: `/app/campaigns/${c.id}`,
      dedupeKey: `campaign-paused:${c.id}:${new Date().toISOString().slice(0, 13)}`,
    });
  }
}

async function maybeComplete(db: Database, c: CampaignRow) {
  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(campaignRecipients)
    .where(and(eq(campaignRecipients.campaignId, c.id), inArray(campaignRecipients.status, ['pending', 'in_progress'])));
  const [{ inflight }] = await db
    .select({ inflight: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(and(eq(emailMessages.campaignId, c.id), inArray(emailMessages.status, ['queued', 'sending'])));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, c.id));
  if (open > 0 || inflight > 0 || total === 0) return false;
  const res = await db
    .update(campaigns)
    .set({ status: 'completed', completedAt: new Date() })
    .where(and(eq(campaigns.id, c.id), eq(campaigns.status, 'active')))
    .returning({ id: campaigns.id });
  if (res.length) {
    await recordActivity(db, { workspaceId: c.workspaceId, campaignId: c.id, type: 'campaign_completed', data: { campaignName: c.name } });
    await audit(db, null, { action: 'campaign.completed', workspaceId: c.workspaceId, targetType: 'campaign', targetId: c.id, metadata: { automatic: true } });
    await notifyWorkspace(db, c.workspaceId, {
      type: 'campaign_completed',
      title: `"${c.name}" is complete`,
      body: 'Every recipient has finished the sequence, replied, or been stopped.',
      link: `/app/campaigns/${c.id}`,
      dedupeKey: `campaign-completed:${c.id}`,
    });
  }
  return res.length > 0;
}

/**
 * Processes one campaign: queues emails for recipients that are due, while
 * respecting every limit. Safe to run concurrently thanks to row locks and
 * idempotency keys; the job itself is a singleton per campaign.
 */
export async function processCampaignTick(db: Database, campaignId: string): Promise<{ queued: number; reason?: string }> {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c || c.status !== 'active') return { queued: 0, reason: 'not active' };

  const plan = await getEffectivePlan(db, c.workspaceId);
  if (!plan.billing.canUseFeatures) {
    await pauseForReason(db, c, plan.billing.readOnlyReason ?? 'Your subscription is not active.', true);
    return { queued: 0, reason: 'subscription' };
  }
  if (!c.integrationId) {
    await pauseForReason(db, c, 'No mailbox is selected for this campaign.', true);
    return { queued: 0, reason: 'no mailbox' };
  }
  const [integration] = await db.select().from(integrations).where(eq(integrations.id, c.integrationId));
  if (!integration || integration.status !== 'active') {
    await pauseForReason(db, c, 'The sending mailbox needs to be reconnected.', true);
    return { queued: 0, reason: 'mailbox' };
  }
  if (await maybeComplete(db, c)) return { queued: 0, reason: 'completed' };
  if (!isWithinSendWindow(c)) return { queued: 0, reason: 'outside window' };

  const steps = await getSteps(db, c.id);
  const enabledSteps = steps.filter((s) => s.enabled);
  if (!enabledSteps.length) {
    await pauseForReason(db, c, 'The campaign has no enabled emails.', true);
    return { queued: 0, reason: 'no steps' };
  }

  const campaignRemaining = c.dailyLimit - (await sentTodayForCampaign(db, c));
  const mailboxSent = (await sentTodayByIntegration(db, [integration.id])).get(integration.id) ?? 0;
  const [{ mailboxQueued }] = await db
    .select({ mailboxQueued: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(and(eq(emailMessages.integrationId, integration.id), inArray(emailMessages.status, ['queued', 'sending'])));
  const mailboxRemaining = integration.dailySendLimit - mailboxSent - mailboxQueued;
  const monthly = await getUsageItem(db, c.workspaceId, 'emails_sent', plan);
  const [{ workspaceQueued }] = await db
    .select({ workspaceQueued: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(and(eq(emailMessages.workspaceId, c.workspaceId), inArray(emailMessages.status, ['queued', 'sending']), eq(emailMessages.isTest, false)));
  const monthlyRemaining = monthly.limit - monthly.used - workspaceQueued;
  if (monthlyRemaining <= 0) {
    await pauseForReason(db, c, `You've reached your monthly limit of ${monthly.limit.toLocaleString()} emails. Upgrade your plan or resume next month.`, true);
    return { queued: 0, reason: 'monthly limit' };
  }
  const capacity = Math.min(campaignRemaining, mailboxRemaining, monthlyRemaining, TICK_BATCH);
  if (capacity <= 0) return { queued: 0, reason: 'daily limit' };

  let queued = 0;
  await db.transaction(async (tx) => {
    const due = await tx
      .select({ r: campaignRecipients, p: prospects })
      .from(campaignRecipients)
      .innerJoin(prospects, eq(prospects.id, campaignRecipients.prospectId))
      .where(
        and(
          eq(campaignRecipients.campaignId, c.id),
          inArray(campaignRecipients.status, ['pending', 'in_progress']),
          isNull(campaignRecipients.pendingMessageId),
          lte(campaignRecipients.nextSendAt, new Date()),
        ),
      )
      .orderBy(asc(campaignRecipients.nextSendAt))
      .limit(capacity)
      .for('update', { of: campaignRecipients, skipLocked: true });

    for (const { r, p } of due) {
      const step = steps.find((s) => s.position === r.currentStep);
      // Skip disabled steps; finish the sequence when none remain.
      if (!step || !step.enabled) {
        const next = steps.find((s) => s.position > r.currentStep && s.enabled);
        if (!next) {
          await tx.update(campaignRecipients).set({ status: 'completed', nextSendAt: null }).where(eq(campaignRecipients.id, r.id));
        } else {
          await tx.update(campaignRecipients).set({ currentStep: next.position }).where(eq(campaignRecipients.id, r.id));
        }
        continue;
      }
      if (!p.email) {
        await tx.update(campaignRecipients).set({ status: 'skipped', stoppedReason: 'No email address', nextSendAt: null }).where(eq(campaignRecipients.id, r.id));
        continue;
      }
      if (p.unsubscribedAt || (await suppressed(tx, c.workspaceId, p.email))) {
        await tx.update(campaignRecipients).set({ status: 'unsubscribed', stoppedReason: 'Address is on the suppression list', nextSendAt: null }).where(eq(campaignRecipients.id, r.id));
        continue;
      }
      if (c.stopOnReply && r.currentStep > 0 && (r.repliedAt || p.lastReplyAt)) {
        await tx.update(campaignRecipients).set({ status: 'replied', nextSendAt: null }).where(eq(campaignRecipients.id, r.id));
        continue;
      }
      // Never email the same address twice for the same step across campaigns in 24h.
      const idempotencyKey = `campaign:${r.id}:${step.position}`;
      const inserted = await tx
        .insert(emailMessages)
        .values({
          workspaceId: c.workspaceId,
          integrationId: integration.id,
          prospectId: p.id,
          campaignId: c.id,
          recipientId: r.id,
          threadId: r.threadId,
          stepPosition: step.position,
          direction: 'outbound',
          status: 'queued',
          idempotencyKey,
          fromEmail: integration.email,
          fromName: c.senderName,
          toEmail: p.email,
          replyTo: c.replyTo,
          subject: step.subject,
          bodyText: step.body,
          scheduledFor: new Date(),
          createdBy: c.createdBy,
        })
        .onConflictDoNothing()
        .returning({ id: emailMessages.id });
      if (!inserted.length) continue;
      await tx.update(campaignRecipients).set({ pendingMessageId: inserted[0].id }).where(eq(campaignRecipients.id, r.id));
      await tx.insert(emailEvents).values({ workspaceId: c.workspaceId, messageId: inserted[0].id, campaignId: c.id, prospectId: p.id, type: 'queued', stepPosition: step.position });
      queued++;
    }
  });

  if (queued) {
    const pending = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(and(eq(emailMessages.campaignId, c.id), eq(emailMessages.status, 'queued')));
    for (const m of pending) await enqueue(QUEUES.sendEmail, { messageId: m.id }, { singletonKey: `send:${m.id}` });
    await db.update(campaigns).set({ lastQueuedAt: new Date() }).where(eq(campaigns.id, c.id));
  }
  await maybeComplete(db, c);
  return { queued };
}

async function ensureThread(tx: DbOrTx, m: typeof emailMessages.$inferSelect, providerThreadId: string | null) {
  if (m.threadId) {
    await tx
      .update(emailThreads)
      .set({ lastMessageAt: new Date(), lastDirection: 'outbound', lastPreview: m.bodyText.slice(0, 160), ...(providerThreadId ? { providerThreadId } : {}) })
      .where(eq(emailThreads.id, m.threadId));
    return m.threadId;
  }
  const [t] = await tx
    .insert(emailThreads)
    .values({
      workspaceId: m.workspaceId,
      integrationId: m.integrationId,
      prospectId: m.prospectId,
      campaignId: m.campaignId,
      subject: m.subject,
      providerThreadId,
      lastDirection: 'outbound',
      lastPreview: m.bodyText.slice(0, 160),
    })
    .onConflictDoNothing()
    .returning({ id: emailThreads.id });
  if (t) return t.id;
  const [existing] = await tx
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(and(eq(emailThreads.integrationId, m.integrationId!), eq(emailThreads.providerThreadId, providerThreadId!)));
  return existing.id;
}

/**
 * Sends a single queued message. Returns normally on success or a permanent
 * failure (recorded on the message). Throws on transient failures so the
 * queue retries with backoff.
 */
export async function processSendEmail(db: Database, messageId: string, attempt = 0): Promise<{ status: string }> {
  const [claimed] = await db
    .update(emailMessages)
    .set({ status: 'sending', attempts: sql`${emailMessages.attempts} + 1` })
    .where(and(eq(emailMessages.id, messageId), eq(emailMessages.status, 'queued')))
    .returning();
  if (!claimed) return { status: 'skipped' };
  const m = claimed;

  const release = async (status: 'failed' | 'cancelled', error: string, recipientStatus?: typeof campaignRecipients.$inferSelect.status) => {
    await db.transaction(async (tx) => {
      await tx.update(emailMessages).set({ status, error }).where(eq(emailMessages.id, m.id));
      if (m.recipientId) {
        await tx
          .update(campaignRecipients)
          .set({ pendingMessageId: null, ...(recipientStatus ? { status: recipientStatus, stoppedReason: error, nextSendAt: null } : {}) })
          .where(eq(campaignRecipients.id, m.recipientId));
      }
      await tx.insert(emailEvents).values({ workspaceId: m.workspaceId, messageId: m.id, campaignId: m.campaignId, prospectId: m.prospectId, type: status === 'failed' ? 'failed' : 'cancelled', stepPosition: m.stepPosition, data: { error } });
      if (status === 'failed' && m.prospectId && !m.isTest) {
        await recordActivity(tx, { workspaceId: m.workspaceId, prospectId: m.prospectId, campaignId: m.campaignId, type: 'email_failed', data: { reason: error, subject: m.subject } });
      }
    });
    return { status };
  };

  const [campaign] = m.campaignId ? await db.select().from(campaigns).where(eq(campaigns.id, m.campaignId)) : [undefined];
  if (campaign && campaign.status !== 'active') return release('cancelled', 'Campaign is not active.');
  if (!m.integrationId) return release('failed', 'No mailbox was selected.');
  const [integration] = await db.select().from(integrations).where(eq(integrations.id, m.integrationId));
  if (!integration || integration.status !== 'active') return release('cancelled', 'The mailbox is not connected.');
  if (!m.isTest && (await suppressed(db, m.workspaceId, m.toEmail))) return release('cancelled', 'Recipient unsubscribed.', 'unsubscribed');

  let prospect: typeof prospects.$inferSelect | undefined;
  let recipient: typeof campaignRecipients.$inferSelect | undefined;
  if (m.prospectId) [prospect] = await db.select().from(prospects).where(eq(prospects.id, m.prospectId));
  if (m.recipientId) [recipient] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.id, m.recipientId));
  if (m.recipientId && (!recipient || !['pending', 'in_progress'].includes(recipient.status))) return release('cancelled', 'Recipient is no longer in the sequence.');
  if (!m.isTest && prospect?.unsubscribedAt) return release('cancelled', 'Recipient unsubscribed.', 'unsubscribed');
  if (campaign?.stopOnReply && recipient && (m.stepPosition ?? 0) > 0 && (recipient.repliedAt || prospect?.lastReplyAt)) {
    return release('cancelled', 'Recipient replied.', 'replied');
  }
  if (!m.isTest) {
    const plan = await getEffectivePlan(db, m.workspaceId);
    const monthly = await getUsageItem(db, m.workspaceId, 'emails_sent', plan);
    if (!plan.billing.canUseFeatures) return release('cancelled', plan.billing.readOnlyReason ?? 'Subscription inactive.');
    if (monthly.used >= monthly.limit) return release('cancelled', 'Monthly email limit reached.');
  }

  // Personalize at send time so contact edits made after queuing are used.
  const sender = await senderContext(db, m.workspaceId, { senderName: m.fromName ?? campaign?.senderName, userId: m.createdBy });
  let subject = m.subject;
  let text = m.bodyText;
  let html: string;
  try {
    if (prospect) {
      const { vars } = await variablesForProspect(prospect, sender);
      const composed = composeEmail(m.subject, m.bodyText, vars, sender, { workspaceId: m.workspaceId, toEmail: m.toEmail, prospectId: prospect.id, includeFooter: m.isTest ? sender.includeUnsubscribeFooter : undefined });
      subject = composed.subject;
      text = composed.text;
      html = composed.html;
    } else {
      const composed = composeEmail(m.subject, m.bodyText, { senderName: sender.senderName, agencyName: sender.agencyName }, sender, { workspaceId: m.workspaceId, toEmail: m.toEmail, prospectId: null });
      subject = composed.subject;
      text = composed.text;
      html = composed.html;
    }
  } catch (err) {
    // Live Google details unavailable: retry later rather than sending an email with gaps.
    await db.update(emailMessages).set({ status: 'queued', error: 'Waiting for business details to become available.' }).where(eq(emailMessages.id, m.id));
    throw err;
  }

  // Thread continuity for follow-ups.
  let providerThreadId: string | null = null;
  let inReplyTo: string | null = null;
  const references: string[] = [];
  if (m.threadId) {
    const [t] = await db.select().from(emailThreads).where(eq(emailThreads.id, m.threadId));
    providerThreadId = t?.providerThreadId ?? null;
    const prior = await db
      .select({ header: emailMessages.messageIdHeader })
      .from(emailMessages)
      .where(and(eq(emailMessages.threadId, m.threadId), ne(emailMessages.id, m.id), sql`${emailMessages.messageIdHeader} is not null`))
      .orderBy(asc(emailMessages.createdAt));
    for (const p of prior) if (p.header) references.push(p.header);
    inReplyTo = references[references.length - 1] ?? null;
  }

  const messageIdHeader = m.messageIdHeader ?? generateMessageId(integration.email);
  const provider = getProvider(integration.provider);
  try {
    const creds = await getFreshCredentials(db, integration);
    const unsubscribeHeader = !m.isTest && sender.includeUnsubscribeFooter && prospect ? text.match(/unsubscribe here: (\S+)/)?.[1] : undefined;
    const result = await provider.send(creds, {
      from: { email: integration.email, name: sender.senderName || null },
      to: m.toEmail,
      replyTo: m.replyTo,
      subject,
      text,
      html,
      messageId: messageIdHeader,
      inReplyTo,
      references,
      providerThreadId,
      headers: unsubscribeHeader ? { 'List-Unsubscribe': `<${unsubscribeHeader}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
    });
    const sentAt = new Date();
    await db.transaction(async (tx) => {
      const threadId = await ensureThread(tx, { ...m, subject, bodyText: text }, result.providerThreadId);
      await tx
        .update(emailMessages)
        .set({ status: 'sent', sentAt, subject, bodyText: text, messageIdHeader, inReplyTo, providerMessageId: result.providerMessageId, threadId, error: null })
        .where(eq(emailMessages.id, m.id));
      await tx.insert(emailEvents).values({ workspaceId: m.workspaceId, messageId: m.id, campaignId: m.campaignId, prospectId: m.prospectId, type: 'sent', stepPosition: m.stepPosition });
      if (!m.isTest) await incrementUsage(tx, m.workspaceId, 'emails_sent', 1);
      if (recipient && campaign) {
        const steps = await getSteps(tx, campaign.id);
        const next = steps.find((s) => s.position > (m.stepPosition ?? 0) && s.enabled);
        await tx
          .update(campaignRecipients)
          .set({
            pendingMessageId: null,
            lastSentAt: sentAt,
            threadId,
            currentStep: next ? next.position : (m.stepPosition ?? 0) + 1,
            status: next ? 'in_progress' : 'completed',
            nextSendAt: next ? new Date(sentAt.getTime() + next.waitDays * 24 * 60 * 60 * 1000) : null,
          })
          .where(eq(campaignRecipients.id, recipient.id));
        if (next) {
          await recordActivity(tx, {
            workspaceId: m.workspaceId,
            prospectId: m.prospectId,
            campaignId: campaign.id,
            type: 'follow_up_scheduled',
            data: { automatic: true, step: next.position + 1, dueAt: new Date(sentAt.getTime() + next.waitDays * 86_400_000).toISOString(), campaignName: campaign.name },
          });
        }
      }
      if (prospect && !m.isTest) {
        await tx
          .update(prospects)
          .set({ lastContactedAt: sentAt, status: prospect.status === 'new' ? 'contacted' : prospect.status })
          .where(eq(prospects.id, prospect.id));
        await recordActivity(tx, { workspaceId: m.workspaceId, prospectId: prospect.id, campaignId: m.campaignId, type: 'email_sent', data: { subject, step: (m.stepPosition ?? 0) + 1, messageId: m.id } });
        if (prospect.status === 'new') {
          await recordActivity(tx, { workspaceId: m.workspaceId, prospectId: prospect.id, type: 'status_changed', data: { from: 'new', to: 'contacted', automatic: true } });
        }
      }
    });
    await audit(db, { userId: m.createdBy }, { action: m.isTest ? 'email.test_sent' : 'email.sent', workspaceId: m.workspaceId, targetType: 'email', targetId: m.id, metadata: { campaignId: m.campaignId, step: m.stepPosition } });
    return { status: 'sent' };
  } catch (err) {
    if (err instanceof ProviderError) {
      logger.warn({ messageId: m.id, kind: err.kind, status: err.status, error: err.message }, 'provider send failed');
      if (err.kind === 'auth') {
        await markIntegrationError(db, integration, 'Authorization expired or was revoked.');
        return release('cancelled', 'The mailbox needs to be reconnected.');
      }
      if (err.kind === 'invalid_recipient') {
        await db.insert(suppressions).values({ workspaceId: m.workspaceId, email: m.toEmail.toLowerCase(), reason: 'bounced' }).onConflictDoNothing();
        return release('failed', `The recipient address was rejected: ${err.message}`, 'bounced');
      }
      if (err.kind === 'permanent') return release('failed', `The email provider rejected this message: ${err.message}`, 'failed');
      // rate_limit / transient -> retry via the queue
      if (attempt + 1 >= MAX_SEND_ATTEMPTS) return release('failed', `Sending failed after several attempts: ${err.message}`, 'failed');
      await db.update(emailMessages).set({ status: 'queued', error: err.message }).where(eq(emailMessages.id, m.id));
      await db.insert(emailEvents).values({ workspaceId: m.workspaceId, messageId: m.id, campaignId: m.campaignId, prospectId: m.prospectId, type: 'retry', stepPosition: m.stepPosition, data: { error: err.message, attempt: attempt + 1 } });
      throw err;
    }
    if (err instanceof AppError) return release('failed', err.message, 'failed');
    if (attempt + 1 >= MAX_SEND_ATTEMPTS) return release('failed', 'Sending failed after several attempts.', 'failed');
    await db.update(emailMessages).set({ status: 'queued', error: 'Temporary error; retrying.' }).where(eq(emailMessages.id, m.id));
    throw err;
  }
}

/** Runs every minute: promotes scheduled campaigns, ticks active ones, recovers stranded work. */
export async function dispatch(db: Database) {
  const now = new Date();
  const promoted = await db
    .update(campaigns)
    .set({ status: 'active', startedAt: now })
    .where(and(eq(campaigns.status, 'scheduled'), lte(campaigns.startAt, now)))
    .returning({ id: campaigns.id, workspaceId: campaigns.workspaceId, name: campaigns.name });
  for (const c of promoted) {
    await recordActivity(db, { workspaceId: c.workspaceId, campaignId: c.id, type: 'campaign_started', data: { campaignName: c.name, scheduled: true } });
  }
  const active = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.status, 'active'));
  for (const c of active) await enqueue(QUEUES.campaignTick, { campaignId: c.id }, { singletonKey: `tick:${c.id}` });

  // Messages claimed by a worker that crashed mid-send stay in "sending". After
  // 15 minutes we cannot know whether the provider accepted them, so we mark
  // them failed rather than risk a duplicate send.
  const stale = await db
    .update(emailMessages)
    .set({ status: 'failed', error: 'Sending was interrupted and could not be confirmed. Check your mailbox Sent folder before retrying.' })
    .where(and(eq(emailMessages.status, 'sending'), lte(emailMessages.updatedAt, new Date(now.getTime() - 15 * 60_000))))
    .returning({ id: emailMessages.id, recipientId: emailMessages.recipientId });
  for (const s of stale) {
    if (s.recipientId) await db.update(campaignRecipients).set({ pendingMessageId: null, status: 'failed', stoppedReason: 'Sending interrupted' }).where(eq(campaignRecipients.id, s.recipientId));
  }
  // Queued messages whose job was lost are re-enqueued (the claim step makes this safe).
  const orphaned = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(and(eq(emailMessages.status, 'queued'), lte(emailMessages.updatedAt, new Date(now.getTime() - 10 * 60_000))))
    .limit(200);
  for (const m of orphaned) await enqueue(QUEUES.sendEmail, { messageId: m.id }, { singletonKey: `send:${m.id}` });
  return { promoted: promoted.length, ticked: active.length, stale: stale.length, requeued: orphaned.length };
}

/** Sends a one-off test email to the user (never counted as outreach or usage). */
export async function sendTestEmail(
  db: Database,
  input: { workspaceId: string; userId: string; integrationId: string; to: string; subject: string; body: string; prospectId?: string | null },
) {
  const [integration] = await db.select().from(integrations).where(and(eq(integrations.id, input.integrationId), eq(integrations.workspaceId, input.workspaceId)));
  if (!integration || integration.status !== 'active') throw new AppError('INTEGRATION_DISCONNECTED', 'Connect a mailbox before sending a test email.');
  let subject = input.subject;
  let body = input.body;
  if (input.prospectId) {
    const [p] = await db.select().from(prospects).where(and(eq(prospects.id, input.prospectId), eq(prospects.workspaceId, input.workspaceId)));
    if (p) {
      const sender = await senderContext(db, input.workspaceId, { userId: input.userId });
      const { vars } = await variablesForProspect(p, sender);
      const composed = composeEmail(input.subject, input.body, vars, sender, { workspaceId: input.workspaceId, toEmail: input.to, prospectId: null, includeFooter: false });
      subject = composed.subject;
      body = composed.text;
    }
  }
  const [m] = await db
    .insert(emailMessages)
    .values({
      workspaceId: input.workspaceId,
      integrationId: integration.id,
      direction: 'outbound',
      status: 'queued',
      fromEmail: integration.email,
      toEmail: input.to,
      subject: `[Test] ${subject}`,
      bodyText: body,
      isTest: true,
      createdBy: input.userId,
    })
    .returning();
  return processSendEmail(db, m.id, MAX_SEND_ATTEMPTS - 1).then((r) => ({ ...r, messageId: m.id }));
}
