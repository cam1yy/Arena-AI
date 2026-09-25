import { and, eq, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  authTokens,
  dailyMetrics,
  emailMessages,
  errorLogs,
  externalApiLogs,
  followUps,
  integrations,
  notifications,
  oauthStates,
  prospects,
  savedSearches,
  searchHistory,
  sessions,
  subscriptions,
  usageCounters,
  workspaces,
  type Database,
} from '@localy/database';
import { MONTHLY_METRICS, type LocationValue } from '@localy/shared';
import { logger } from '../logger';
import { notifyWorkspace } from './notifications';
import { currentPeriod, getEffectivePlan, getUsageItem, WARNING_THRESHOLD } from './usage';
import { healthCheckIntegration } from './integrations';
import { syncIntegrationInbox } from './inbox';

const DAY = 86_400_000;
export const GOOGLE_COORDINATE_RETENTION_DAYS = 30;

/**
 * Enforces Google Maps Platform caching limits and general data hygiene:
 *  - clears Google-sourced coordinates older than 30 days from search history
 *    and saved searches (the place ID is kept, so locations can be re-resolved)
 *  - removes expired sessions, tokens, OAuth states and old logs
 */
export async function runCleanup(db: Database) {
  const coordCutoff = new Date(Date.now() - GOOGLE_COORDINATE_RETENTION_DAYS * DAY);
  const stripCoords = (loc: LocationValue): LocationValue => ({ ...loc, lat: null, lng: null, resolvedAt: null });

  const oldHistory = await db
    .select({ id: searchHistory.id, location: searchHistory.location })
    .from(searchHistory)
    .where(and(isNotNull(searchHistory.coordsCachedAt), lt(searchHistory.coordsCachedAt, coordCutoff)))
    .limit(5000);
  for (const h of oldHistory) {
    await db.update(searchHistory).set({ location: stripCoords(h.location), coordsCachedAt: null }).where(eq(searchHistory.id, h.id));
  }
  const oldSaved = await db
    .select({ id: savedSearches.id, config: savedSearches.config })
    .from(savedSearches)
    .where(and(isNotNull(savedSearches.coordsCachedAt), lt(savedSearches.coordsCachedAt, coordCutoff)))
    .limit(5000);
  for (const s of oldSaved) {
    await db.update(savedSearches).set({ config: { ...s.config, location: stripCoords(s.config.location) }, coordsCachedAt: null }).where(eq(savedSearches.id, s.id));
  }
  // Workspace default / preferred locations chosen from Google are refreshed the same way.
  const wsRows = await db.select({ id: workspaces.id, settings: workspaces.settings }).from(workspaces);
  for (const w of wsRows) {
    const s = w.settings ?? {};
    let changed = false;
    const fix = (loc: LocationValue | null | undefined) => {
      if (loc && loc.source === 'google' && loc.lat != null && (!loc.resolvedAt || new Date(loc.resolvedAt) < coordCutoff)) {
        changed = true;
        return stripCoords(loc);
      }
      return loc ?? null;
    };
    const defaultLocation = fix(s.defaultLocation);
    const preferredLocations = (s.preferredLocations ?? []).map((l) => fix(l)!).filter(Boolean);
    if (changed) await db.update(workspaces).set({ settings: { ...s, defaultLocation, preferredLocations } }).where(eq(workspaces.id, w.id));
  }

  const now = new Date();
  const expiredSessions = await db.delete(sessions).where(sql`${sessions.expiresAt} < ${now} or (${sessions.revokedAt} is not null and ${sessions.revokedAt} < ${new Date(now.getTime() - 30 * DAY)})`).returning({ id: sessions.id });
  await db.delete(authTokens).where(lt(authTokens.expiresAt, new Date(now.getTime() - 7 * DAY)));
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, now));
  await db.delete(externalApiLogs).where(lt(externalApiLogs.createdAt, new Date(now.getTime() - 30 * DAY)));
  await db.delete(errorLogs).where(lt(errorLogs.createdAt, new Date(now.getTime() - 90 * DAY)));
  await db.delete(notifications).where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, new Date(now.getTime() - 90 * DAY))));
  // Monthly usage counters are kept for 13 months for billing history.
  const cutoffPeriod = currentPeriod(new Date(now.getTime() - 400 * DAY));
  await db.delete(usageCounters).where(and(inArray(usageCounters.metric, MONTHLY_METRICS as string[]), lt(usageCounters.period, cutoffPeriod)));

  const result = { searchHistoryCoordsCleared: oldHistory.length, savedSearchCoordsCleared: oldSaved.length, sessionsRemoved: expiredSessions.length };
  logger.info(result, 'cleanup complete');
  return result;
}

/** Notifies users about manual follow-up reminders that are due. */
export async function runFollowUpReminders(db: Database) {
  const due = await db
    .select({ f: followUps, prospectName: prospects.name })
    .from(followUps)
    .innerJoin(prospects, eq(prospects.id, followUps.prospectId))
    .where(and(eq(followUps.status, 'scheduled'), lte(followUps.dueAt, new Date()), isNull(followUps.notifiedAt)))
    .limit(500);
  for (const { f, prospectName } of due) {
    await notifyWorkspace(db, f.workspaceId, {
      type: 'follow_up_due',
      title: `Follow up with ${prospectName ?? 'a prospect'}`,
      body: f.note ?? 'A follow-up you scheduled is due.',
      link: `/app/prospects/${f.prospectId}`,
      dedupeKey: `followup:${f.id}`,
      onlyUserIds: f.createdBy ? [f.createdBy] : undefined,
    });
    await db.update(followUps).set({ notifiedAt: new Date() }).where(eq(followUps.id, f.id));
  }
  return { notified: due.length };
}

/** Warns workspaces approaching or at their monthly limits, and expires trials. */
export async function runUsageChecks(db: Database) {
  const subs = await db.select({ workspaceId: subscriptions.workspaceId, status: subscriptions.status, trialEndsAt: subscriptions.trialEndsAt, stripeSubscriptionId: subscriptions.stripeSubscriptionId }).from(subscriptions);
  let warnings = 0;
  for (const s of subs) {
    if (s.status === 'trialing' && s.trialEndsAt && !s.stripeSubscriptionId) {
      const daysLeft = Math.ceil((s.trialEndsAt.getTime() - Date.now()) / DAY);
      if (daysLeft <= 0) {
        await db.update(subscriptions).set({ status: 'expired' }).where(eq(subscriptions.workspaceId, s.workspaceId));
        await notifyWorkspace(db, s.workspaceId, { type: 'payment_issue', title: 'Your free trial has ended', body: 'Choose a plan to keep discovering businesses and sending outreach. Your data is safe.', link: '/app/billing', dedupeKey: `trial-ended:${s.workspaceId}`, roles: ['owner', 'admin'] });
        continue;
      }
      if (daysLeft <= 3) {
        await notifyWorkspace(db, s.workspaceId, { type: 'usage_warning', title: `Your trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, body: 'Choose a plan to keep your campaigns running without interruption.', link: '/app/billing', dedupeKey: `trial-ending:${s.workspaceId}:${daysLeft}`, roles: ['owner', 'admin'] });
      }
    }
    try {
      const plan = await getEffectivePlan(db, s.workspaceId);
      if (!plan.billing.canUseFeatures) continue;
      for (const metric of ['businesses_discovered', 'emails_sent'] as const) {
        const item = await getUsageItem(db, s.workspaceId, metric, plan);
        if (item.used >= item.limit * WARNING_THRESHOLD) {
          const label = metric === 'businesses_discovered' ? 'discovery' : 'email';
          const exceeded = item.used >= item.limit;
          await notifyWorkspace(db, s.workspaceId, {
            type: 'usage_warning',
            title: exceeded ? `You've reached your monthly ${label} limit` : `You're approaching your monthly ${label} limit`,
            body: `${item.used.toLocaleString()} of ${item.limit.toLocaleString()} used this month.`,
            link: '/app/billing',
            dedupeKey: `usage:${metric}:${exceeded ? 'exceeded' : 'warning'}:${currentPeriod()}`,
          });
          warnings++;
        }
      }
    } catch (err) {
      logger.warn({ err, workspaceId: s.workspaceId }, 'usage check failed');
    }
  }
  return { warnings };
}

export async function runIntegrationHealthChecks(db: Database) {
  const rows = await db.select().from(integrations).where(eq(integrations.status, 'active'));
  let failed = 0;
  for (const i of rows) {
    if (i.provider === 'sandbox') continue;
    const res = await healthCheckIntegration(db, i);
    if (!res.ok) failed++;
  }
  return { checked: rows.length, failed };
}

export async function runInboxSync(db: Database) {
  const rows = await db.select({ id: integrations.id }).from(integrations).where(and(eq(integrations.status, 'active'), sql`${integrations.provider} <> 'sandbox'`));
  let processed = 0;
  for (const r of rows) {
    try {
      processed += (await syncIntegrationInbox(db, r.id)).processed;
    } catch (err) {
      logger.warn({ err, integrationId: r.id }, 'inbox sync failed');
    }
  }
  return { integrations: rows.length, processed };
}

/** Rolls up yesterday's and today's activity into daily_metrics for fast reporting. */
export async function runAnalyticsAggregation(db: Database) {
  const since = new Date(Date.now() - 2 * DAY);
  since.setUTCHours(0, 0, 0, 0);
  const rows = await db.execute<{ workspace_id: string; day: string; sent: number; received: number }>(sql`
    select workspace_id, to_char(date_trunc('day', coalesce(sent_at, received_at)), 'YYYY-MM-DD') as day,
      count(*) filter (where direction = 'outbound' and status in ('sent','bounced') and is_test = false)::int as sent,
      count(*) filter (where direction = 'inbound')::int as received
    from ${emailMessages}
    where coalesce(sent_at, received_at) >= ${since}
    group by 1, 2
  `);
  for (const r of rows.rows) {
    await db
      .insert(dailyMetrics)
      .values({ workspaceId: r.workspace_id, day: r.day, metrics: { sent: Number(r.sent), received: Number(r.received) } })
      .onConflictDoUpdate({ target: [dailyMetrics.workspaceId, dailyMetrics.day], set: { metrics: { sent: Number(r.sent), received: Number(r.received) }, updatedAt: new Date() } });
  }
  return { rows: rows.rows.length };
}
