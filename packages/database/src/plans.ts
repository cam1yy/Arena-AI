import type { PlanLimits } from '@localy/shared';
import { getConfig } from '@localy/config';
import { sql } from 'drizzle-orm';
import type { DbOrTx } from './client';
import { plans } from './schema';

/**
 * Default plan catalogue. Limits and descriptions live in the `plans` table and
 * can be edited by a platform admin. Prices are never stored here; they are
 * read from Stripe using each plan's Stripe price ID.
 */
export const DEFAULT_PLANS: {
  key: string;
  name: string;
  description: string;
  limits: PlanLimits;
  features: string[];
  sortOrder: number;
  priceEnv?: 'STRIPE_PRICE_ID_PRO' | 'STRIPE_PRICE_ID_AGENCY';
}[] = [
  {
    key: 'trial',
    name: 'Free trial',
    description: 'Try Localy with a single mailbox and modest monthly limits.',
    limits: {
      businesses_discovered: 300,
      places_requests: 3000,
      emails_sent: 100,
      prospects: 250,
      active_campaigns: 2,
      mailboxes: 1,
      seats: 1,
    },
    features: ['Map-based discovery', 'Prospect management', 'Templates and campaigns', 'One connected mailbox'],
    sortOrder: 0,
  },
  {
    key: 'pro',
    name: 'Pro',
    description: 'For freelancers and small studios doing regular outreach.',
    limits: {
      businesses_discovered: 3000,
      places_requests: 25000,
      emails_sent: 2000,
      prospects: 5000,
      active_campaigns: 10,
      mailboxes: 3,
      seats: 3,
    },
    features: ['Everything in the trial', 'Follow-up sequences', 'Three mailboxes', 'Three team members', 'Data export'],
    sortOrder: 1,
    priceEnv: 'STRIPE_PRICE_ID_PRO',
  },
  {
    key: 'agency',
    name: 'Agency',
    description: 'For agencies running outreach across several markets.',
    limits: {
      businesses_discovered: 15000,
      places_requests: 100000,
      emails_sent: 10000,
      prospects: 50000,
      active_campaigns: 50,
      mailboxes: 15,
      seats: 15,
    },
    features: ['Everything in Pro', 'Fifteen mailboxes', 'Fifteen team members', 'API access', 'Priority support'],
    sortOrder: 2,
    priceEnv: 'STRIPE_PRICE_ID_AGENCY',
  },
];

/**
 * Inserts any missing plans. Existing rows are left untouched so admin edits
 * survive deployments, except that an empty Stripe price ID is filled from the
 * environment when one is configured.
 */
export async function ensurePlans(db: DbOrTx): Promise<void> {
  const cfg = getConfig();
  for (const p of DEFAULT_PLANS) {
    const priceId = p.priceEnv ? (cfg[p.priceEnv] ?? null) : null;
    await db
      .insert(plans)
      .values({
        key: p.key,
        name: p.name,
        description: p.description,
        limits: p.limits,
        features: p.features,
        sortOrder: p.sortOrder,
        stripePriceId: priceId,
      })
      .onConflictDoUpdate({
        target: plans.key,
        set: { stripePriceId: sql`coalesce(${plans.stripePriceId}, excluded.stripe_price_id)` },
      });
  }
}
