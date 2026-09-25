import { and, asc, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { getConfig } from '@localy/config';
import { plans, stripeEvents, subscriptions, users, workspaceMembers, workspaces, type Database } from '@localy/database';
import type { PlanKey, PlanView } from '@localy/shared';
import { AppError, badRequest, notConfigured } from '../errors';
import type { WorkspaceContext } from '../context';
import { assertCan } from '../permissions';
import { audit } from '../audit';
import { logger } from '../logger';
import { getEffectivePlan, getUsageSummary } from './usage';
import { notifyWorkspace } from './notifications';

/*
 * Stripe billing. Plans (names, limits, features) live in the `plans` table
 * and are editable by platform admins. Prices are never hardcoded: each paid
 * plan references a Stripe Price ID and the amount shown is read from Stripe.
 * Subscription state is written only by the webhook handler (and an explicit
 * sync after Checkout), so the browser can never grant itself a plan.
 */

let client: Stripe | undefined;
export function stripe(): Stripe {
  const cfg = getConfig();
  if (!cfg.STRIPE_SECRET_KEY) throw notConfigured('Billing', ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID_PRO', 'STRIPE_PRICE_ID_AGENCY']);
  if (!client) {
    const opts: Record<string, unknown> = { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'Localy' } };
    if (cfg.STRIPE_API_BASE_URL) {
      const u = new URL(cfg.STRIPE_API_BASE_URL);
      Object.assign(opts, { host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), protocol: u.protocol.replace(':', '') });
    }
    client = new Stripe(cfg.STRIPE_SECRET_KEY, opts as ConstructorParameters<typeof Stripe>[1]);
  }
  return client;
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = err as { type?: string; message?: string; code?: string };
  logger.error({ type: e.type, code: e.code, message: e.message }, 'stripe error');
  if (e.type === 'StripeCardError') return new AppError('PAYMENT_ERROR', e.message ?? 'Your card was declined.');
  if (e.type === 'StripeInvalidRequestError') return new AppError('PAYMENT_ERROR', 'Billing could not process this request. Please contact support if it continues.');
  return new AppError('EXTERNAL_SERVICE_ERROR', 'Billing is temporarily unavailable. Please try again shortly.');
}

const priceCache = new Map<string, { value: PlanView['price']; expires: number }>();

async function priceFor(priceId: string | null): Promise<PlanView['price']> {
  if (!priceId || !getConfig().features.stripe) return null;
  const hit = priceCache.get(priceId);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const p = await stripe().prices.retrieve(priceId);
    const value = p.unit_amount == null ? null : { amount: p.unit_amount / 100, currency: p.currency.toUpperCase(), interval: p.recurring?.interval ?? 'one-time' };
    priceCache.set(priceId, { value, expires: Date.now() + 10 * 60_000 });
    return value;
  } catch (err) {
    logger.warn({ err, priceId }, 'could not load price from Stripe');
    return null;
  }
}

export async function listPlans(db: Database): Promise<PlanView[]> {
  const rows = await db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder));
  return Promise.all(
    rows.map(async (p) => {
      const price = await priceFor(p.stripePriceId);
      return {
        key: p.key as PlanKey,
        name: p.name,
        description: p.description,
        limits: p.limits,
        features: p.features,
        price,
        purchasable: Boolean(p.stripePriceId && getConfig().features.stripe && p.key !== 'trial'),
      };
    }),
  );
}

export async function billingOverview(ctx: WorkspaceContext) {
  assertCan(ctx, 'billing.read');
  const plan = await getEffectivePlan(ctx.db, ctx.workspaceId);
  const [usage, planList] = await Promise.all([getUsageSummary(ctx.db, ctx.workspaceId), listPlans(ctx.db)]);
  let paymentMethod: { brand: string; last4: string; expMonth: number; expYear: number } | null = null;
  let invoices: { id: string; number: string | null; amount: number; currency: string; status: string | null; created: string; hostedUrl: string | null; pdfUrl: string | null }[] = [];
  let stripeError: string | null = null;
  const [ws] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
  if (getConfig().features.stripe && ws?.stripeCustomerId) {
    try {
      const s = stripe();
      const customer = await s.customers.retrieve(ws.stripeCustomerId, { expand: ['invoice_settings.default_payment_method'] });
      if (!('deleted' in customer && customer.deleted)) {
        const pm = (customer as Stripe.Customer).invoice_settings?.default_payment_method;
        if (pm && typeof pm === 'object' && pm.card) {
          paymentMethod = { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
        }
      }
      if (!paymentMethod && plan.subscription.stripeSubscriptionId) {
        const sub = await s.subscriptions.retrieve(plan.subscription.stripeSubscriptionId, { expand: ['default_payment_method'] });
        const pm = sub.default_payment_method;
        if (pm && typeof pm === 'object' && pm.card) paymentMethod = { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
      }
      const list = await s.invoices.list({ customer: ws.stripeCustomerId, limit: 12 });
      invoices = list.data.map((i) => ({
        id: i.id ?? '',
        number: i.number,
        amount: (i.amount_paid || i.amount_due) / 100,
        currency: i.currency.toUpperCase(),
        status: i.status,
        created: new Date(i.created * 1000).toISOString(),
        hostedUrl: i.hosted_invoice_url ?? null,
        pdfUrl: i.invoice_pdf ?? null,
      }));
    } catch (err) {
      logger.warn({ err }, 'failed to load Stripe billing details');
      stripeError = 'Billing details are temporarily unavailable.';
    }
  }
  return {
    billing: plan.billing,
    limits: plan.limits,
    usage,
    plans: planList,
    paymentMethod,
    invoices,
    stripeConfigured: getConfig().features.stripe,
    hasStripeCustomer: Boolean(ws?.stripeCustomerId),
    hasStripeSubscription: Boolean(plan.subscription.stripeSubscriptionId),
    stripeError,
  };
}

async function ensureCustomer(ctx: WorkspaceContext) {
  const [ws] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
  if (ws.stripeCustomerId) return ws.stripeCustomerId;
  const [owner] = await ctx.db
    .select({ email: users.email, name: users.name })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.role, 'owner')))
    .limit(1);
  const customer = await stripe().customers.create(
    { email: owner?.email, name: ws.name, metadata: { workspaceId: ws.id } },
    { idempotencyKey: `customer-${ws.id}` },
  );
  await ctx.db.update(workspaces).set({ stripeCustomerId: customer.id }).where(eq(workspaces.id, ws.id));
  return customer.id;
}

export async function createCheckoutSession(ctx: WorkspaceContext, planKey: string): Promise<{ url: string | null; changed?: boolean }> {
  assertCan(ctx, 'billing.manage', 'Only workspace owners and admins can change the plan.');
  const [plan] = await ctx.db.select().from(plans).where(and(eq(plans.key, planKey), eq(plans.isActive, true)));
  if (!plan || plan.key === 'trial') throw badRequest('Choose a paid plan.');
  if (!plan.stripePriceId) throw notConfigured(`The ${plan.name} plan`, [`STRIPE_PRICE_ID_${plan.key.toUpperCase()}`]);
  const current = await getEffectivePlan(ctx.db, ctx.workspaceId);
  if (current.subscription.stripeSubscriptionId && ['active', 'trialing', 'past_due'].includes(current.subscription.status)) {
    return changePlan(ctx, planKey);
  }
  try {
    const customer = await ensureCustomer(ctx);
    const appUrl = getConfig().APP_URL.replace(/\/$/, '');
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      client_reference_id: ctx.workspaceId,
      subscription_data: { metadata: { workspaceId: ctx.workspaceId, planKey: plan.key } },
      metadata: { workspaceId: ctx.workspaceId, planKey: plan.key },
      allow_promotion_codes: true,
      success_url: `${appUrl}/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/app/billing?checkout=canceled`,
    });
    await audit(ctx.db, ctx, { action: 'billing.checkout_started', workspaceId: ctx.workspaceId, metadata: { plan: plan.key } });
    return { url: session.url };
  } catch (err) {
    throw toAppError(err);
  }
}

/** Upgrade or downgrade an existing Stripe subscription with proration. */
export async function changePlan(ctx: WorkspaceContext, planKey: string): Promise<{ url: string | null; changed?: boolean }> {
  assertCan(ctx, 'billing.manage', 'Only workspace owners and admins can change the plan.');
  const [plan] = await ctx.db.select().from(plans).where(and(eq(plans.key, planKey), eq(plans.isActive, true)));
  if (!plan?.stripePriceId || plan.key === 'trial') throw badRequest('Choose a paid plan.');
  const current = await getEffectivePlan(ctx.db, ctx.workspaceId);
  const subId = current.subscription.stripeSubscriptionId;
  if (!subId) return createCheckoutSession(ctx, planKey);
  if (current.planKey === plan.key) return { url: null, changed: false };
  try {
    const s = stripe();
    const sub = await s.subscriptions.retrieve(subId);
    const item = sub.items.data[0];
    const updated = await s.subscriptions.update(subId, {
      items: [{ id: item.id, price: plan.stripePriceId }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
      metadata: { workspaceId: ctx.workspaceId, planKey: plan.key },
    });
    await applyStripeSubscription(ctx.db, updated);
    await audit(ctx.db, ctx, { action: 'billing.plan_changed', workspaceId: ctx.workspaceId, metadata: { from: current.planKey, to: plan.key } });
    return { url: null, changed: true };
  } catch (err) {
    throw toAppError(err);
  }
}

export async function cancelSubscription(ctx: WorkspaceContext, resume = false) {
  assertCan(ctx, 'billing.manage');
  const current = await getEffectivePlan(ctx.db, ctx.workspaceId);
  const subId = current.subscription.stripeSubscriptionId;
  if (!subId) throw badRequest('There is no paid subscription to change.');
  try {
    const updated = await stripe().subscriptions.update(subId, { cancel_at_period_end: !resume });
    await applyStripeSubscription(ctx.db, updated);
    await audit(ctx.db, ctx, { action: resume ? 'billing.resumed' : 'billing.canceled', workspaceId: ctx.workspaceId });
  } catch (err) {
    throw toAppError(err);
  }
}

export async function createPortalSession(ctx: WorkspaceContext) {
  assertCan(ctx, 'billing.manage');
  try {
    const customer = await ensureCustomer(ctx);
    const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${getConfig().APP_URL.replace(/\/$/, '')}/app/billing` });
    return { url: session.url };
  } catch (err) {
    throw toAppError(err);
  }
}

/** Confirms a Checkout session on return, so the plan updates even before the webhook arrives. */
export async function syncCheckoutSession(ctx: WorkspaceContext, sessionId: string) {
  assertCan(ctx, 'billing.read');
  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
    if (session.client_reference_id !== ctx.workspaceId) throw badRequest('This checkout session belongs to a different workspace.');
    if (session.subscription && typeof session.subscription === 'object') await applyStripeSubscription(ctx.db, session.subscription);
    return { status: session.status };
  } catch (err) {
    throw toAppError(err);
  }
}

function planKeyForPrice(planRows: (typeof plans.$inferSelect)[], priceId: string | undefined, fallback?: string) {
  return planRows.find((p) => p.stripePriceId && p.stripePriceId === priceId)?.key ?? fallback ?? null;
}

export async function applyStripeSubscription(db: Database, sub: Stripe.Subscription) {
  const workspaceId = sub.metadata?.workspaceId;
  let wsId = workspaceId;
  if (!wsId) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.stripeCustomerId, customerId));
    wsId = ws?.id;
  }
  if (!wsId) {
    logger.warn({ subscription: sub.id }, 'stripe subscription without a matching workspace');
    return;
  }
  const planRows = await db.select().from(plans);
  const item = sub.items.data[0];
  const priceId = item?.price?.id;
  const planKey = planKeyForPrice(planRows, priceId, sub.metadata?.planKey);
  if (!planKey) {
    logger.warn({ subscription: sub.id, priceId }, 'stripe price does not match any plan');
    return;
  }
  const statusMap: Record<string, typeof subscriptions.$inferSelect.status> = {
    trialing: 'trialing',
    active: 'active',
    past_due: 'past_due',
    canceled: 'canceled',
    unpaid: 'unpaid',
    incomplete: 'incomplete',
    incomplete_expired: 'canceled',
    paused: 'unpaid',
  };
  const [before] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, wsId));
  const status = statusMap[sub.status] ?? 'incomplete';
  const values = {
    planKey: status === 'canceled' ? 'trial' : planKey,
    status: status === 'canceled' ? ('canceled' as const) : status,
    stripeSubscriptionId: status === 'canceled' ? null : sub.id,
    stripePriceId: priceId ?? null,
    currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : (before?.trialEndsAt ?? null),
  };
  await db.update(subscriptions).set(values).where(eq(subscriptions.workspaceId, wsId));
  await audit(db, null, { action: 'billing.subscription_synced', workspaceId: wsId, targetType: 'subscription', targetId: sub.id, metadata: { status: values.status, plan: values.planKey } });
  if (before && before.status !== 'past_due' && values.status === 'past_due') {
    await notifyWorkspace(db, wsId, {
      type: 'payment_issue',
      title: 'Payment failed',
      body: 'We could not charge your payment method. Update it to avoid interruption.',
      link: '/app/billing',
      dedupeKey: `payment-failed:${sub.id}:${values.currentPeriodEnd?.toISOString() ?? ''}`,
      roles: ['owner', 'admin'],
    });
  }
}

/** Verifies the webhook signature and applies the event exactly once. */
export async function handleStripeWebhook(db: Database, rawBody: Buffer, signature: string | undefined) {
  const cfg = getConfig();
  if (!cfg.STRIPE_WEBHOOK_SECRET) throw notConfigured('Stripe webhooks', ['STRIPE_WEBHOOK_SECRET']);
  if (!signature) throw badRequest('Missing Stripe signature.');
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature, cfg.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new AppError('BAD_REQUEST', 'Invalid Stripe signature.');
  }
  const inserted = await db.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning();
  if (!inserted.length) return { duplicate: true };
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.client_reference_id && session.customer) {
          const customerId = typeof session.customer === 'string' ? session.customer : session.customer.id;
          await db.update(workspaces).set({ stripeCustomerId: customerId }).where(eq(workspaces.id, session.client_reference_id));
        }
        if (session.subscription) {
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          await applyStripeSubscription(db, await stripe().subscriptions.retrieve(subId));
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applyStripeSubscription(db, event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.stripeCustomerId, customerId));
          if (ws) {
            await notifyWorkspace(db, ws.id, {
              type: 'payment_issue',
              title: 'Payment failed',
              body: 'Your latest invoice could not be paid. Update your payment method to keep your plan.',
              link: '/app/billing',
              dedupeKey: `invoice-failed:${invoice.id}`,
              roles: ['owner', 'admin'],
            });
          }
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // Allow Stripe to retry by removing the processed marker.
    await db.delete(stripeEvents).where(eq(stripeEvents.id, event.id));
    throw err;
  }
  return { duplicate: false, type: event.type };
}
