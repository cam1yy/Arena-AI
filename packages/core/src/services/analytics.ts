import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  activities,
  campaignRecipients,
  campaigns,
  discoveredPlaces,
  emailEvents,
  emailMessages,
  followUps,
  prospects,
  searchHistory,
  type DbOrTx,
} from '@localy/database';
import { getProvider } from '@localy/email';
import type { WorkspaceContext } from '../context';
import { listActivity } from './activity';
import { campaignStats } from './campaigns';

export type AnalyticsRange = '7d' | '30d' | '90d' | 'all';

function rangeStart(range: AnalyticsRange): Date | null {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : null;
  if (!days) return null;
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d;
}

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/**
 * Workspace analytics computed directly from recorded events. Nothing is
 * estimated. Opens are not tracked, and delivery means "accepted by the
 * sending provider and no bounce received", which is labelled in the UI.
 */
export async function getAnalytics(ctx: WorkspaceContext, range: AnalyticsRange, campaignId?: string) {
  const start = rangeStart(range);
  const ws = ctx.workspaceId;

  const msgConds: SQL[] = [eq(emailMessages.workspaceId, ws), eq(emailMessages.direction, 'outbound'), eq(emailMessages.isTest, false)];
  if (start) msgConds.push(gte(sql`coalesce(${emailMessages.sentAt}, ${emailMessages.updatedAt})`, start));
  if (campaignId) msgConds.push(eq(emailMessages.campaignId, campaignId));
  const [msg] = await ctx.db
    .select({
      sent: sql<number>`count(*) filter (where ${emailMessages.status} in ('sent','bounced'))::int`,
      bounced: sql<number>`count(*) filter (where ${emailMessages.status} = 'bounced')::int`,
      failed: sql<number>`count(*) filter (where ${emailMessages.status} = 'failed')::int`,
      followUps: sql<number>`count(*) filter (where ${emailMessages.status} in ('sent','bounced') and ${emailMessages.stepPosition} > 0)::int`,
      initial: sql<number>`count(*) filter (where ${emailMessages.status} in ('sent','bounced') and coalesce(${emailMessages.stepPosition}, 0) = 0 and ${emailMessages.campaignId} is not null)::int`,
    })
    .from(emailMessages)
    .where(and(...msgConds));

  // Replies: prospects who replied (first reply per campaign recipient) within the range.
  const recConds: SQL[] = [eq(campaignRecipients.workspaceId, ws), sql`${campaignRecipients.repliedAt} is not null`];
  if (start) recConds.push(gte(campaignRecipients.repliedAt, start));
  if (campaignId) recConds.push(eq(campaignRecipients.campaignId, campaignId));
  const [rep] = await ctx.db
    .select({
      replies: sql<number>`count(*)::int`,
      positive: sql<number>`count(*) filter (where ${prospects.status} in ('interested','client'))::int`,
    })
    .from(campaignRecipients)
    .innerJoin(prospects, eq(prospects.id, campaignRecipients.prospectId))
    .where(and(...recConds));

  const contactedConds: SQL[] = [eq(campaignRecipients.workspaceId, ws), sql`${campaignRecipients.lastSentAt} is not null`];
  if (campaignId) contactedConds.push(eq(campaignRecipients.campaignId, campaignId));
  if (start) contactedConds.push(gte(campaignRecipients.lastSentAt, start));
  const [contacted] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(campaignRecipients).where(and(...contactedConds));

  const discConds: SQL[] = [eq(discoveredPlaces.workspaceId, ws)];
  if (start) discConds.push(gte(discoveredPlaces.firstSeenAt, start));
  const [disc] = campaignId ? [{ n: null as number | null }] : await ctx.db.select({ n: sql<number>`count(*)::int` }).from(discoveredPlaces).where(and(...discConds));

  const prosConds: SQL[] = [eq(prospects.workspaceId, ws)];
  if (start) prosConds.push(gte(prospects.createdAt, start));
  if (campaignId) prosConds.push(sql`exists (select 1 from ${campaignRecipients} where ${campaignRecipients.prospectId} = ${prospects.id} and ${campaignRecipients.campaignId} = ${campaignId})`);
  const [pros] = await ctx.db
    .select({
      saved: sql<number>`count(*)::int`,
      clients: sql<number>`count(*) filter (where ${prospects.status} = 'client')::int`,
      interested: sql<number>`count(*) filter (where ${prospects.status} in ('interested','client'))::int`,
    })
    .from(prospects)
    .where(and(...prosConds));

  // Conversions: prospects moved to "client" within the range.
  const convConds: SQL[] = [eq(activities.workspaceId, ws), eq(activities.type, 'status_changed'), sql`${activities.data} ->> 'to' = 'client'`];
  if (start) convConds.push(gte(activities.createdAt, start));
  if (campaignId) convConds.push(sql`exists (select 1 from ${campaignRecipients} where ${campaignRecipients.prospectId} = ${activities.prospectId} and ${campaignRecipients.campaignId} = ${campaignId})`);
  const [conv] = await ctx.db.select({ n: sql<number>`count(distinct ${activities.prospectId})::int` }).from(activities).where(and(...convConds));

  const delivered = msg.sent - msg.bounced;
  const series = await dailySeries(ctx.db, ws, start, campaignId);
  const funnel = await statusFunnel(ctx.db, ws, campaignId);
  const campaignRows = await campaignPerformance(ctx, start, campaignId);

  return {
    range,
    campaignId: campaignId ?? null,
    metrics: {
      businessesDiscovered: disc.n,
      prospectsSaved: pros.saved,
      emailsSent: msg.sent,
      delivered,
      deliveryRate: pct(delivered, msg.sent),
      bounced: msg.bounced,
      failed: msg.failed,
      contacted: contacted.n,
      replies: rep.replies,
      replyRate: pct(rep.replies, contacted.n),
      positiveReplies: rep.positive,
      followUpsSent: msg.followUps,
      conversions: conv.n,
      conversionRate: pct(conv.n, contacted.n),
    },
    series,
    funnel,
    campaigns: campaignRows,
    definitions: {
      delivered: 'Emails accepted by your mail provider with no bounce received. Gmail and Outlook do not confirm inbox placement.',
      replyRate: 'Prospects who replied, divided by prospects contacted in the same period.',
      positiveReplies: 'Replies from prospects you have marked Interested or Client.',
      conversions: 'Prospects moved to Client in this period. Mark prospects as Client to track conversions.',
      opens: 'Localy does not track opens. Open tracking relies on hidden images that are unreliable and raise privacy concerns.',
    },
    providerCapabilities: Object.fromEntries((['gmail', 'microsoft'] as const).map((p) => [p, getProvider(p).capabilities])),
  };
}

async function dailySeries(db: DbOrTx, ws: string, start: Date | null, campaignId?: string) {
  const from = start ?? (await firstActivityDate(db, ws));
  const days: string[] = [];
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  // Cap the series at ~180 points by bucketing into weeks for long ranges.
  const totalDays = Math.round((today.getTime() - cursor.getTime()) / 86_400_000) + 1;
  const bucketDays = totalDays > 180 ? 7 : 1;
  while (cursor <= today) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + bucketDays);
  }
  const bucket = bucketDays === 7 ? sql`date_trunc('week', ts)` : sql`date_trunc('day', ts)`;
  const campaignFilterMsg = campaignId ? sql`and campaign_id = ${campaignId}` : sql``;
  const rows = await db.execute<{ day: string; metric: string; n: number }>(sql`
    with events as (
      select sent_at as ts, 'sent' as metric from ${emailMessages}
        where workspace_id = ${ws} and direction = 'outbound' and is_test = false and status in ('sent','bounced') and sent_at >= ${from} ${campaignFilterMsg}
      union all
      select replied_at as ts, 'replies' as metric from ${campaignRecipients}
        where workspace_id = ${ws} and replied_at is not null and replied_at >= ${from} ${campaignId ? sql`and campaign_id = ${campaignId}` : sql``}
      union all
      select created_at as ts, 'prospects' as metric from ${prospects}
        where workspace_id = ${ws} and created_at >= ${from}
      ${campaignId ? sql`` : sql`union all select first_seen_at as ts, 'discovered' as metric from ${discoveredPlaces} where workspace_id = ${ws} and first_seen_at >= ${from}`}
    )
    select to_char(${bucket}, 'YYYY-MM-DD') as day, metric, count(*)::int as n from events group by 1, 2
  `);
  const map = new Map<string, Record<string, number>>();
  for (const r of rows.rows) {
    const entry = map.get(r.day) ?? {};
    entry[r.metric] = Number(r.n);
    map.set(r.day, entry);
  }
  return {
    bucket: bucketDays === 7 ? 'week' : 'day',
    points: days.map((d) => ({ date: d, sent: map.get(d)?.sent ?? 0, replies: map.get(d)?.replies ?? 0, prospects: map.get(d)?.prospects ?? 0, discovered: map.get(d)?.discovered ?? 0 })),
  };
}

async function firstActivityDate(db: DbOrTx, ws: string) {
  const [r] = await db.select({ d: sql<Date | null>`min(${activities.createdAt})` }).from(activities).where(eq(activities.workspaceId, ws));
  const d = r?.d ? new Date(r.d) : new Date();
  const min = new Date();
  min.setUTCDate(min.getUTCDate() - 29);
  return d < min ? d : min;
}

async function statusFunnel(db: DbOrTx, ws: string, campaignId?: string) {
  const conds: SQL[] = [eq(prospects.workspaceId, ws)];
  if (campaignId) conds.push(sql`exists (select 1 from ${campaignRecipients} where ${campaignRecipients.prospectId} = ${prospects.id} and ${campaignRecipients.campaignId} = ${campaignId})`);
  const rows = await db.select({ status: prospects.status, n: sql<number>`count(*)::int` }).from(prospects).where(and(...conds)).groupBy(prospects.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

async function campaignPerformance(ctx: WorkspaceContext, start: Date | null, campaignId?: string) {
  const conds: SQL[] = [eq(campaigns.workspaceId, ctx.workspaceId)];
  if (campaignId) conds.push(eq(campaigns.id, campaignId));
  if (start) conds.push(sql`(${campaigns.completedAt} is null or ${campaigns.completedAt} >= ${start})`);
  const rows = await ctx.db.select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, kind: campaigns.kind }).from(campaigns).where(and(...conds)).orderBy(desc(campaigns.createdAt)).limit(50);
  const stats = await campaignStats(ctx.db, rows.map((r) => r.id));
  return rows.map((r) => {
    const s = stats.get(r.id)!;
    const contacted = s.sent > 0 ? s.recipients - s.pending : 0;
    return { ...r, ...s, replyRate: pct(s.replies, Math.max(contacted, 0)) };
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function getDashboard(ctx: WorkspaceContext) {
  const ws = ctx.workspaceId;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const now = new Date();
  const [pros] = await ctx.db
    .select({
      total: sql<number>`count(*) filter (where ${prospects.status} <> 'archived')::int`,
      newThisWeek: sql<number>`count(*) filter (where ${prospects.createdAt} >= ${weekAgo})::int`,
      noWebsite: sql<number>`count(*) filter (where ${prospects.status} <> 'archived' and (${prospects.websiteStatus} in ('not_listed','unavailable') or ${prospects.socialProfileOnly}))::int`,
      byNew: sql<number>`count(*) filter (where ${prospects.status} = 'new')::int`,
    })
    .from(prospects)
    .where(eq(prospects.workspaceId, ws));
  const [msgs] = await ctx.db
    .select({
      sent: sql<number>`count(*) filter (where ${emailMessages.status} in ('sent','bounced'))::int`,
      sentWeek: sql<number>`count(*) filter (where ${emailMessages.status} in ('sent','bounced') and ${emailMessages.sentAt} >= ${weekAgo})::int`,
      queued: sql<number>`count(*) filter (where ${emailMessages.status} in ('queued','sending'))::int`,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.workspaceId, ws), eq(emailMessages.direction, 'outbound'), eq(emailMessages.isTest, false)));
  const [reps] = await ctx.db
    .select({
      replies: sql<number>`count(distinct ${emailMessages.prospectId})::int`,
      repliesWeek: sql<number>`count(distinct ${emailMessages.prospectId}) filter (where ${emailMessages.receivedAt} >= ${weekAgo})::int`,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.workspaceId, ws), eq(emailMessages.direction, 'inbound')));
  const [positive] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, ws), sql`${prospects.lastReplyAt} is not null`, inArray(prospects.status, ['interested', 'client'])));
  const [dueReminders] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(followUps)
    .where(and(eq(followUps.workspaceId, ws), eq(followUps.status, 'scheduled'), lte(followUps.dueAt, new Date(now.getTime() + 86_400_000))));
  const [dueSequence] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(and(eq(campaignRecipients.workspaceId, ws), eq(campaignRecipients.status, 'in_progress'), inArray(campaigns.status, ['active', 'paused']), lte(campaignRecipients.nextSendAt, new Date(now.getTime() + 86_400_000))));
  const [discWeek] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(discoveredPlaces).where(and(eq(discoveredPlaces.workspaceId, ws), gte(discoveredPlaces.firstSeenAt, weekAgo)));

  const activeCampaigns = await ctx.db
    .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, ws), inArray(campaigns.status, ['active', 'scheduled', 'paused'])))
    .orderBy(desc(campaigns.updatedAt))
    .limit(5);
  const stats = await campaignStats(ctx.db, activeCampaigns.map((c) => c.id));
  const recentSearches = await ctx.db
    .select({ id: searchHistory.id, categories: searchHistory.categories, keyword: searchHistory.keyword, location: searchHistory.location, resultCount: searchHistory.resultCount, opportunityCount: searchHistory.opportunityCount, createdAt: searchHistory.createdAt, radiusMeters: searchHistory.radiusMeters })
    .from(searchHistory)
    .where(eq(searchHistory.workspaceId, ws))
    .orderBy(desc(searchHistory.createdAt))
    .limit(5);
  const recentOutreach = await ctx.db
    .select({ id: emailMessages.id, subject: emailMessages.subject, toEmail: emailMessages.toEmail, status: emailMessages.status, sentAt: emailMessages.sentAt, prospectId: emailMessages.prospectId, prospectName: prospects.name, placeId: prospects.placeId, direction: emailMessages.direction, receivedAt: emailMessages.receivedAt, threadId: emailMessages.threadId })
    .from(emailMessages)
    .leftJoin(prospects, eq(prospects.id, emailMessages.prospectId))
    .where(and(eq(emailMessages.workspaceId, ws), eq(emailMessages.isTest, false), inArray(emailMessages.status, ['sent', 'received', 'bounced', 'failed'])))
    .orderBy(desc(sql`coalesce(${emailMessages.sentAt}, ${emailMessages.receivedAt}, ${emailMessages.updatedAt})`))
    .limit(6);
  const activity = await listActivity(ctx, {
    limit: 12,
    types: ['discovery_search', 'email_sent', 'reply_received', 'campaign_started', 'campaign_completed', 'campaign_paused', 'prospect_created', 'status_changed', 'follow_up_scheduled'],
  });
  const [weekEvents] = await ctx.db
    .select({ sentEvents: sql<number>`count(*) filter (where ${emailEvents.type} = 'sent')::int` })
    .from(emailEvents)
    .where(and(eq(emailEvents.workspaceId, ws), gte(emailEvents.createdAt, weekAgo)));

  return {
    stats: {
      totalProspects: pros.total,
      newProspects: pros.newThisWeek,
      newStatusProspects: pros.byNew,
      withoutWebsite: pros.noWebsite,
      emailsSent: msgs.sent,
      emailsSentThisWeek: msgs.sentWeek,
      emailsQueued: msgs.queued,
      replies: reps.replies,
      repliesThisWeek: reps.repliesWeek,
      positiveReplies: positive.n,
      followUpsDue: dueReminders.n + dueSequence.n,
      discoveredThisWeek: discWeek.n,
    },
    weekSummary: {
      discovered: discWeek.n,
      sent: weekEvents.sentEvents,
      replies: reps.repliesWeek,
      followUpsDue: dueReminders.n + dueSequence.n,
    },
    campaigns: activeCampaigns.map((c) => ({ ...c, stats: stats.get(c.id)! })),
    recentSearches: recentSearches.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
    recentOutreach: recentOutreach.map((m) => ({ ...m, sentAt: m.sentAt?.toISOString() ?? null, receivedAt: m.receivedAt?.toISOString() ?? null })),
    activity,
  };
}

// ---------------------------------------------------------------------------
// Follow-ups overview
// ---------------------------------------------------------------------------

export async function listFollowUps(ctx: WorkspaceContext, opts: { window: 'overdue' | 'today' | 'upcoming' | 'all' }) {
  const now = new Date();
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  const reminderConds: SQL[] = [eq(followUps.workspaceId, ctx.workspaceId), eq(followUps.status, 'scheduled')];
  if (opts.window === 'overdue') reminderConds.push(lte(followUps.dueAt, now));
  if (opts.window === 'today') reminderConds.push(lte(followUps.dueAt, endToday));
  if (opts.window === 'upcoming') reminderConds.push(gte(followUps.dueAt, now));
  const reminders = await ctx.db
    .select({ f: followUps, prospectName: prospects.name, placeId: prospects.placeId })
    .from(followUps)
    .innerJoin(prospects, eq(prospects.id, followUps.prospectId))
    .where(and(...reminderConds))
    .orderBy(followUps.dueAt)
    .limit(200);
  const seqConds: SQL[] = [eq(campaignRecipients.workspaceId, ctx.workspaceId), eq(campaignRecipients.status, 'in_progress'), sql`${campaignRecipients.nextSendAt} is not null`];
  if (opts.window === 'overdue') seqConds.push(lte(campaignRecipients.nextSendAt, now));
  if (opts.window === 'today') seqConds.push(lte(campaignRecipients.nextSendAt, endToday));
  if (opts.window === 'upcoming') seqConds.push(gte(campaignRecipients.nextSendAt, now));
  const seq = await ctx.db
    .select({ r: campaignRecipients, prospectName: prospects.name, placeId: prospects.placeId, campaignName: campaigns.name, campaignStatus: campaigns.status })
    .from(campaignRecipients)
    .innerJoin(prospects, eq(prospects.id, campaignRecipients.prospectId))
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(and(...seqConds, inArray(campaigns.status, ['active', 'paused'])))
    .orderBy(campaignRecipients.nextSendAt)
    .limit(200);
  const items = [
    ...reminders.map((r) => ({
      id: r.f.id,
      kind: 'reminder' as const,
      prospectId: r.f.prospectId,
      placeId: r.placeId,
      prospectName: r.prospectName ?? '',
      campaignId: null,
      campaignName: null,
      dueAt: r.f.dueAt.toISOString(),
      note: r.f.note,
      stepPosition: null,
      status: r.f.status,
    })),
    ...seq.map((s) => ({
      id: s.r.id,
      kind: 'sequence' as const,
      prospectId: s.r.prospectId,
      placeId: s.placeId,
      prospectName: s.prospectName ?? '',
      campaignId: s.r.campaignId,
      campaignName: s.campaignName,
      dueAt: s.r.nextSendAt!.toISOString(),
      note: s.campaignStatus === 'paused' ? 'Campaign is paused' : null,
      stepPosition: s.r.currentStep,
      status: s.campaignStatus === 'paused' ? 'paused' : 'scheduled',
    })),
  ].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return items;
}
