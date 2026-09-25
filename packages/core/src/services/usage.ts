import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  campaigns,
  integrations,
  plans,
  prospects,
  subscriptions,
  usageCounters,
  workspaceMembers,
  type DbOrTx,
} from '@localy/database';
import {
  MONTHLY_METRICS,
  USAGE_METRIC_LABELS,
  USAGE_METRICS,
  type BillingState,
  type PlanKey,
  type PlanLimits,
  type UsageItem,
  type UsageMetric,
} from '@localy/shared';
import { AppError } from '../errors';

export const WARNING_THRESHOLD = 0.8;

export function currentPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const ACTIVE_STATUSES = ['trialing', 'active', 'past_due'] as const;

export interface EffectivePlan {
  planKey: PlanKey;
  planName: string;
  limits: PlanLimits;
  subscription: typeof subscriptions.$inferSelect;
  billing: BillingState;
}

/**
 * Resolves the workspace's plan and limits from the database. Billing state is
 * always evaluated server-side; the browser's view is informational only.
 */
export async function getEffectivePlan(db: DbOrTx, workspaceId: string): Promise<EffectivePlan> {
  const [row] = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.key, subscriptions.planKey))
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  if (!row) throw new AppError('SUBSCRIPTION_INACTIVE', 'This workspace has no subscription. Choose a plan to continue.');
  const { sub, plan } = row;
  const now = Date.now();
  let status = sub.status;
  if (status === 'trialing' && sub.trialEndsAt && sub.trialEndsAt.getTime() < now && !sub.stripeSubscriptionId) status = 'expired';
  const canUseFeatures = (ACTIVE_STATUSES as readonly string[]).includes(status);
  let readOnlyReason: string | null = null;
  if (!canUseFeatures) {
    readOnlyReason =
      status === 'expired'
        ? 'Your free trial has ended. Choose a plan to keep discovering businesses and sending outreach. Your data is safe.'
        : status === 'canceled'
          ? 'Your subscription has been canceled. Choose a plan to resume. Your data is safe.'
          : status === 'unpaid'
            ? 'Your subscription is unpaid. Update your payment method to resume.'
            : 'Your subscription is not active. Update billing to continue.';
  }
  const limits = { ...plan.limits, ...(sub.limitOverrides ?? {}) } as PlanLimits;
  return {
    planKey: plan.key as PlanKey,
    planName: plan.name,
    limits,
    subscription: sub,
    billing: {
      planKey: plan.key as PlanKey,
      planName: plan.name,
      status,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canUseFeatures,
      readOnlyReason,
    },
  };
}

export async function assertActiveSubscription(db: DbOrTx, workspaceId: string) {
  const plan = await getEffectivePlan(db, workspaceId);
  if (!plan.billing.canUseFeatures) {
    throw new AppError('SUBSCRIPTION_INACTIVE', plan.billing.readOnlyReason ?? 'Your subscription is not active.', {
      details: { status: plan.billing.status, upgradeUrl: '/app/billing' },
    });
  }
  return plan;
}

export async function getMonthlyCount(db: DbOrTx, workspaceId: string, metric: UsageMetric, period = currentPeriod()) {
  const [r] = await db
    .select({ count: usageCounters.count })
    .from(usageCounters)
    .where(and(eq(usageCounters.workspaceId, workspaceId), eq(usageCounters.metric, metric), eq(usageCounters.period, period)));
  return r?.count ?? 0;
}

export async function incrementUsage(db: DbOrTx, workspaceId: string, metric: UsageMetric, by = 1, period = currentPeriod()) {
  if (by <= 0) return;
  await db
    .insert(usageCounters)
    .values({ workspaceId, metric, period, count: by })
    .onConflictDoUpdate({
      target: [usageCounters.workspaceId, usageCounters.metric, usageCounters.period],
      set: { count: sql`${usageCounters.count} + ${by}`, updatedAt: new Date() },
    });
}

async function currentCount(db: DbOrTx, workspaceId: string, metric: UsageMetric): Promise<number> {
  if ((MONTHLY_METRICS as string[]).includes(metric)) return getMonthlyCount(db, workspaceId, metric);
  if (metric === 'prospects') {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(prospects).where(eq(prospects.workspaceId, workspaceId));
    return r?.n ?? 0;
  }
  if (metric === 'active_campaigns') {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, workspaceId), inArray(campaigns.status, ['active', 'scheduled'])));
    return r?.n ?? 0;
  }
  if (metric === 'mailboxes') {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(integrations)
      .where(and(eq(integrations.workspaceId, workspaceId), sql`${integrations.status} <> 'disconnected'`));
    return r?.n ?? 0;
  }
  if (metric === 'seats') {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    return r?.n ?? 0;
  }
  return 0;
}

function toItem(metric: UsageMetric, used: number, limit: number): UsageItem {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const monthly = (MONTHLY_METRICS as string[]).includes(metric);
  const warns = monthly || metric === 'prospects';
  return {
    metric,
    label: USAGE_METRIC_LABELS[metric],
    used,
    limit,
    monthly,
    percent,
    warning: warns && used >= limit * WARNING_THRESHOLD && used < limit,
    exceeded: monthly ? used >= limit : used > limit,
    atCapacity: !monthly && used === limit,
  };
}

export async function getUsageItem(db: DbOrTx, workspaceId: string, metric: UsageMetric, plan?: EffectivePlan): Promise<UsageItem> {
  const p = plan ?? (await getEffectivePlan(db, workspaceId));
  return toItem(metric, await currentCount(db, workspaceId, metric), p.limits[metric]);
}

export async function getUsageSummary(db: DbOrTx, workspaceId: string): Promise<UsageItem[]> {
  const plan = await getEffectivePlan(db, workspaceId);
  return Promise.all(USAGE_METRICS.map(async (m) => toItem(m, await currentCount(db, workspaceId, m), plan.limits[m])));
}

const LIMIT_MESSAGES: Record<UsageMetric, (limit: number) => string> = {
  businesses_discovered: (l) => `You've reached your monthly discovery limit of ${l.toLocaleString()} businesses.`,
  places_requests: (l) => `You've reached your monthly limit of ${l.toLocaleString()} map search requests.`,
  emails_sent: (l) => `You've reached your monthly limit of ${l.toLocaleString()} emails.`,
  prospects: (l) => `You've reached your limit of ${l.toLocaleString()} saved prospects.`,
  active_campaigns: (l) => `You've reached your limit of ${l.toLocaleString()} active campaigns.`,
  mailboxes: (l) => `You've reached your limit of ${l.toLocaleString()} connected mailboxes.`,
  seats: (l) => `You've reached your limit of ${l.toLocaleString()} workspace members.`,
};

/**
 * Throws LIMIT_REACHED if performing `adding` more units would exceed the
 * plan limit. The error includes current usage so the UI can explain the limit
 * and offer an upgrade without losing the user's unsaved work.
 */
export async function assertWithinLimit(db: DbOrTx, workspaceId: string, metric: UsageMetric, adding = 1): Promise<UsageItem> {
  const plan = await assertActiveSubscription(db, workspaceId);
  const item = await getUsageItem(db, workspaceId, metric, plan);
  if (item.used + adding > item.limit) {
    const remaining = Math.max(0, item.limit - item.used);
    throw new AppError('LIMIT_REACHED', `${LIMIT_MESSAGES[metric](item.limit)} ${remaining > 0 ? `You have ${remaining.toLocaleString()} remaining this period.` : 'Upgrade your plan to continue.'}`, {
      details: { usage: item, remaining, plan: plan.planKey, upgradeUrl: '/app/billing' },
    });
  }
  return item;
}

/** Returns how many of `requested` units can be used before hitting the limit. */
export async function remainingAllowance(db: DbOrTx, workspaceId: string, metric: UsageMetric): Promise<number> {
  const item = await getUsageItem(db, workspaceId, metric);
  return Math.max(0, item.limit - item.used);
}
