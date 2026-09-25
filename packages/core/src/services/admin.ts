import { and, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import {
  auditLogs,
  campaigns,
  errorLogs,
  externalApiLogs,
  integrations,
  plans,
  prospects,
  sessions,
  subscriptions,
  systemSettings,
  usageCounters,
  users,
  workspaceMembers,
  workspaces,
  type Database,
} from '@localy/database';
import type { PlanLimits } from '@localy/shared';
import { getConfig } from '@localy/config';
import { badRequest, notFound } from '../errors';
import { audit } from '../audit';
import type { ActorContext } from '../context';
import { getQueue, QUEUES } from '../queue';
import { currentPeriod } from './usage';
import { broadcastSystemNotification } from './notifications';
import { cancelQueuedForCampaign } from './campaigns';

/*
 * Platform administration. Access is controlled exclusively by
 * users.is_platform_admin plus a recent password re-confirmation on the
 * session; workspace roles never grant access to anything in this module.
 */

const like = (q: string) => `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

export async function adminOverview(db: Database) {
  const since24h = new Date(Date.now() - 86_400_000);
  const [u] = await db.select({ total: sql<number>`count(*)::int`, new7d: sql<number>`count(*) filter (where ${users.createdAt} > now() - interval '7 days')::int` }).from(users);
  const [w] = await db.select({ total: sql<number>`count(*)::int` }).from(workspaces);
  const subs = await db.select({ planKey: subscriptions.planKey, status: subscriptions.status, n: sql<number>`count(*)::int` }).from(subscriptions).groupBy(subscriptions.planKey, subscriptions.status);
  const [c] = await db.select({ active: sql<number>`count(*) filter (where ${campaigns.status} = 'active')::int`, total: sql<number>`count(*)::int` }).from(campaigns);
  const [i] = await db.select({ active: sql<number>`count(*) filter (where ${integrations.status} = 'active')::int`, errored: sql<number>`count(*) filter (where ${integrations.status} = 'error')::int` }).from(integrations);
  const [e] = await db.select({ n: sql<number>`count(*)::int` }).from(errorLogs).where(gte(errorLogs.createdAt, since24h));
  const usage = await db
    .select({ metric: usageCounters.metric, total: sql<number>`sum(${usageCounters.count})::int` })
    .from(usageCounters)
    .where(eq(usageCounters.period, currentPeriod()))
    .groupBy(usageCounters.metric);
  return { users: u, workspaces: w.total, subscriptions: subs, campaigns: c, integrations: i, errors24h: e.n, usageThisMonth: Object.fromEntries(usage.map((x) => [x.metric, x.total])) };
}

export async function adminListUsers(db: Database, q: string | undefined, page: number) {
  const where = q ? or(ilike(users.email, like(q)), ilike(users.name, like(q))) : undefined;
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      isPlatformAdmin: users.isPlatformAdmin,
      disabledAt: users.disabledAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      twoFactor: sql<boolean>`${users.twoFactorEnabledAt} is not null`,
      workspaces: sql<number>`(select count(*)::int from ${workspaceMembers} where ${workspaceMembers.userId} = ${users.id})`,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(50)
    .offset((page - 1) * 50);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);
  return { items: rows, total, page, pageSize: 50 };
}

export async function adminSetUserDisabled(db: Database, actor: ActorContext, userId: string, disabled: boolean) {
  if (userId === actor.userId) throw badRequest('You cannot disable your own account.');
  const [u] = await db.update(users).set({ disabledAt: disabled ? new Date() : null }).where(eq(users.id, userId)).returning({ id: users.id });
  if (!u) throw notFound('User');
  if (disabled) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
  await audit(db, actor, { action: disabled ? 'admin.user_disabled' : 'admin.user_enabled', targetType: 'user', targetId: userId });
}

export async function adminListWorkspaces(db: Database, q: string | undefined, page: number) {
  const where = q ? ilike(workspaces.name, like(q)) : undefined;
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      createdAt: workspaces.createdAt,
      planKey: subscriptions.planKey,
      status: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      limitOverrides: subscriptions.limitOverrides,
      members: sql<number>`(select count(*)::int from ${workspaceMembers} where ${workspaceMembers.workspaceId} = ${workspaces.id})`,
      prospects: sql<number>`(select count(*)::int from ${prospects} where ${prospects.workspaceId} = ${workspaces.id})`,
      campaigns: sql<number>`(select count(*)::int from ${campaigns} where ${campaigns.workspaceId} = ${workspaces.id})`,
      isDevData: workspaces.isDevData,
    })
    .from(workspaces)
    .leftJoin(subscriptions, eq(subscriptions.workspaceId, workspaces.id))
    .where(where)
    .orderBy(desc(workspaces.createdAt))
    .limit(50)
    .offset((page - 1) * 50);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(workspaces).where(where);
  const usage = rows.length
    ? await db
        .select({ workspaceId: usageCounters.workspaceId, metric: usageCounters.metric, count: usageCounters.count })
        .from(usageCounters)
        .where(and(eq(usageCounters.period, currentPeriod()), sql`${usageCounters.workspaceId} in ${rows.map((r) => r.id)}`))
    : [];
  return {
    items: rows.map((r) => ({ ...r, usage: Object.fromEntries(usage.filter((u) => u.workspaceId === r.id).map((u) => [u.metric, u.count])) })),
    total,
    page,
    pageSize: 50,
  };
}

export async function adminUpdateSubscription(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  input: { planKey?: string; status?: typeof subscriptions.$inferSelect.status; trialEndsAt?: string | null; limitOverrides?: Partial<PlanLimits> | null },
) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  if (!sub) throw notFound('Subscription');
  if (input.planKey) {
    const [p] = await db.select().from(plans).where(eq(plans.key, input.planKey));
    if (!p) throw badRequest('Unknown plan.');
  }
  await db
    .update(subscriptions)
    .set({
      ...(input.planKey ? { planKey: input.planKey } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.trialEndsAt !== undefined ? { trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null } : {}),
      ...(input.limitOverrides !== undefined ? { limitOverrides: input.limitOverrides } : {}),
    })
    .where(eq(subscriptions.workspaceId, workspaceId));
  await audit(db, actor, { action: 'admin.subscription_updated', workspaceId, targetType: 'subscription', targetId: sub.id, metadata: input as Record<string, unknown> });
}

export async function adminListCampaigns(db: Database, status: string | undefined, page: number) {
  const where = status && status !== 'all' ? eq(campaigns.status, status as typeof campaigns.$inferSelect.status) : undefined;
  const rows = await db
    .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, kind: campaigns.kind, workspaceId: campaigns.workspaceId, workspaceName: workspaces.name, createdAt: campaigns.createdAt, pauseReason: campaigns.pauseReason, dailyLimit: campaigns.dailyLimit })
    .from(campaigns)
    .innerJoin(workspaces, eq(workspaces.id, campaigns.workspaceId))
    .where(where)
    .orderBy(desc(campaigns.createdAt))
    .limit(50)
    .offset((page - 1) * 50);
  return { items: rows, page };
}

export async function adminPauseCampaign(db: Database, actor: ActorContext, campaignId: string, reason: string) {
  const [c] = await db.update(campaigns).set({ status: 'paused', pauseReason: `Paused by Localy support: ${reason}` }).where(eq(campaigns.id, campaignId)).returning();
  if (!c) throw notFound('Campaign');
  await cancelQueuedForCampaign(db, campaignId, 'Paused by Localy support.');
  await audit(db, actor, { action: 'admin.campaign_paused', workspaceId: c.workspaceId, targetType: 'campaign', targetId: campaignId, metadata: { reason } });
}

export async function adminListIntegrations(db: Database, page: number) {
  const rows = await db
    .select({ id: integrations.id, provider: integrations.provider, email: integrations.email, status: integrations.status, lastError: integrations.lastError, lastSyncedAt: integrations.lastSyncedAt, lastHealthCheckAt: integrations.lastHealthCheckAt, workspaceName: workspaces.name, createdAt: integrations.createdAt })
    .from(integrations)
    .innerJoin(workspaces, eq(workspaces.id, integrations.workspaceId))
    .orderBy(desc(integrations.createdAt))
    .limit(50)
    .offset((page - 1) * 50);
  return { items: rows, page };
}

export async function adminApiHealth(db: Database) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      service: externalApiLogs.service,
      operation: externalApiLogs.operation,
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where not ${externalApiLogs.ok})::int`,
      p50: sql<number>`percentile_cont(0.5) within group (order by ${externalApiLogs.durationMs})::int`,
      p95: sql<number>`percentile_cont(0.95) within group (order by ${externalApiLogs.durationMs})::int`,
      lastError: sql<string | null>`(array_agg(${externalApiLogs.errorCode} order by ${externalApiLogs.createdAt} desc) filter (where not ${externalApiLogs.ok}))[1]`,
    })
    .from(externalApiLogs)
    .where(gte(externalApiLogs.createdAt, since))
    .groupBy(externalApiLogs.service, externalApiLogs.operation)
    .orderBy(externalApiLogs.service);
  let queues: { name: string; queued: number; active: number; failed?: number }[];
  try {
    const q = await getQueue();
    const list = await q.getQueues(Object.values(QUEUES));
    queues = list.map((x) => ({ name: x.name, queued: (x as { queuedCount?: number }).queuedCount ?? 0, active: (x as { activeCount?: number }).activeCount ?? 0 }));
  } catch {
    queues = [];
  }
  const cfg = getConfig();
  return {
    services: rows,
    queues,
    configuration: {
      googlePlaces: cfg.features.places,
      googleMapsBrowser: cfg.features.maps,
      googleOAuth: cfg.features.googleSignIn,
      microsoftOAuth: cfg.features.microsoft,
      stripe: cfg.features.stripe,
      stripeWebhooks: cfg.features.stripeWebhooks,
      smtp: cfg.features.smtp,
      ai: cfg.features.ai,
    },
  };
}

export async function adminErrorLogs(db: Database, page: number) {
  const rows = await db.select().from(errorLogs).orderBy(desc(errorLogs.createdAt)).limit(50).offset((page - 1) * 50);
  return { items: rows, page };
}

export async function adminAuditLogs(db: Database, opts: { page: number; action?: string; workspaceId?: string; userId?: string }) {
  const conds = [];
  if (opts.action) conds.push(ilike(auditLogs.action, like(opts.action)));
  if (opts.workspaceId) conds.push(eq(auditLogs.workspaceId, opts.workspaceId));
  if (opts.userId) conds.push(eq(auditLogs.userId, opts.userId));
  const rows = await db
    .select()
    .from(auditLogs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(50)
    .offset((opts.page - 1) * 50);
  return { items: rows, page: opts.page };
}

export const SYSTEM_SETTING_KEYS = ['announcement', 'signups_enabled', 'maintenance_message'] as const;

export async function getSystemSettings(db: Database) {
  const rows = await db.select().from(systemSettings);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    announcement: (map.announcement as { message: string; level: 'info' | 'warning' } | null) ?? null,
    signupsEnabled: map.signups_enabled === undefined ? true : Boolean(map.signups_enabled),
  };
}

export async function updateSystemSettings(db: Database, actor: ActorContext, input: { announcement?: { message: string; level: 'info' | 'warning' } | null; signupsEnabled?: boolean; notifyUsers?: boolean }) {
  if (input.announcement !== undefined) {
    await db.insert(systemSettings).values({ key: 'announcement', value: input.announcement, updatedBy: actor.userId }).onConflictDoUpdate({ target: systemSettings.key, set: { value: input.announcement, updatedBy: actor.userId } });
    if (input.announcement && input.notifyUsers) await broadcastSystemNotification(db, 'Announcement', input.announcement.message);
  }
  if (input.signupsEnabled !== undefined) {
    await db.insert(systemSettings).values({ key: 'signups_enabled', value: input.signupsEnabled, updatedBy: actor.userId }).onConflictDoUpdate({ target: systemSettings.key, set: { value: input.signupsEnabled, updatedBy: actor.userId } });
  }
  await audit(db, actor, { action: 'admin.settings_updated', metadata: input as Record<string, unknown> });
  return getSystemSettings(db);
}

export async function adminListPlans(db: Database) {
  return db.select().from(plans).orderBy(plans.sortOrder);
}

export async function adminUpdatePlan(db: Database, actor: ActorContext, key: string, input: { name?: string; description?: string; limits?: PlanLimits; features?: string[]; stripePriceId?: string | null; isActive?: boolean }) {
  const [p] = await db.update(plans).set(input).where(eq(plans.key, key)).returning();
  if (!p) throw notFound('Plan');
  await audit(db, actor, { action: 'admin.settings_updated', targetType: 'plan', targetId: key, metadata: input as Record<string, unknown> });
  return p;
}
