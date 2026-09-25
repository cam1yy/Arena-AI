import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { closeDb, getDb, integrations, oauthStates, subscriptions, users, workspaces } from '@localy/database';
import { sha256 } from '@localy/core';
import { client, getApp, PASSWORD, signUp } from '../support/harness';

let app: Awaited<ReturnType<typeof getApp>>;
beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

const stripe = new Stripe('sk_test_fake_key');

function webhook(event: object) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' });
  return app.inject({ method: 'POST', url: '/api/webhooks/stripe', payload, headers: { 'content-type': 'application/json', 'stripe-signature': header } });
}

function subscriptionEvent(id: string, type: string, workspaceId: string, price: string, status = 'active', extra: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    object: 'event',
    type,
    data: {
      object: {
        id: `sub_${workspaceId.slice(0, 8)}`,
        object: 'subscription',
        customer: 'cus_test_1',
        status,
        cancel_at_period_end: false,
        canceled_at: null,
        trial_end: null,
        metadata: { workspaceId },
        items: { object: 'list', data: [{ id: 'si_1', price: { id: price }, current_period_start: now, current_period_end: now + 30 * 86400 }] },
        ...extra,
      },
    },
  };
}

describe('billing', () => {
  it('lists plans with prices read from Stripe, not hardcoded', async () => {
    const res = await client(app).json<{ plans: { key: string; price: { amount: number; currency: string } | null; purchasable: boolean }[] }>('GET', '/api/plans');
    const pro = res.body.plans.find((p) => p.key === 'pro')!;
    expect(pro.price).toEqual({ amount: 29, currency: 'USD', interval: 'month' });
    expect(pro.purchasable).toBe(true);
    expect(res.body.plans.find((p) => p.key === 'trial')!.purchasable).toBe(false);
  });

  it('creates a Stripe Checkout session for owners', async () => {
    const { client: c, workspaceId } = await signUp(app);
    const res = await c.json<{ url: string }>('POST', '/api/billing/checkout', { plan: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe(`https://checkout.stripe.test/${workspaceId}`);
    const [ws] = await getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws.stripeCustomerId).toMatch(/^cus_test_/);
  });

  it('rejects webhooks with an invalid signature', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', payload: JSON.stringify({ id: 'evt_x', type: 'customer.subscription.updated' }), headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' } });
    expect(res.statusCode).toBe(400);
  });

  it('applies subscription changes from signed webhooks exactly once and enforces the new limits server-side', async () => {
    const { client: c, workspaceId } = await signUp(app);
    const evt = subscriptionEvent(`evt_${Date.now()}`, 'customer.subscription.updated', workspaceId, 'price_pro_test');
    expect((await webhook(evt)).statusCode).toBe(200);
    const dup = await webhook(evt);
    expect(JSON.parse(dup.body).duplicate).toBe(true);
    const [sub] = await getDb().select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
    expect(sub).toMatchObject({ planKey: 'pro', status: 'active' });
    const me = await c.json<{ billing: { planKey: string } }>('GET', '/api/me');
    expect(me.body.billing.planKey).toBe('pro');
    const usage = await c.json<{ usage: { metric: string; limit: number }[] }>('GET', '/api/usage');
    expect(usage.body.usage.find((u) => u.metric === 'emails_sent')!.limit).toBe(2000);
  });

  it('downgrades to read-only when the subscription is canceled, keeping data', async () => {
    const { client: c, workspaceId } = await signUp(app);
    await c.json('POST', '/api/prospects', { name: 'Kept Prospect' });
    await webhook(subscriptionEvent(`evt_a_${Date.now()}`, 'customer.subscription.updated', workspaceId, 'price_pro_test'));
    await webhook(subscriptionEvent(`evt_b_${Date.now()}`, 'customer.subscription.deleted', workspaceId, 'price_pro_test', 'canceled'));
    const me = await c.json<{ billing: { canUseFeatures: boolean; readOnlyReason: string } }>('GET', '/api/me');
    expect(me.body.billing.canUseFeatures).toBe(false);
    expect(me.body.billing.readOnlyReason).toMatch(/canceled/);
    const list = await c.json<{ total: number }>('GET', '/api/prospects');
    expect(list.body.total).toBe(1);
    const blocked = await c.json<{ error: { code: string } }>('POST', '/api/prospects', { name: 'New one' });
    expect(blocked.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('does not trust any client-side plan state', async () => {
    const { client: c } = await signUp(app);
    // There is no endpoint that lets a normal user set a plan; attempts are rejected or ignored.
    expect((await c.json('PATCH', '/api/workspace', { planKey: 'agency' })).status).toBe(200);
    const me = await c.json<{ billing: { planKey: string } }>('GET', '/api/me');
    expect(me.body.billing.planKey).toBe('trial');
    expect((await c.json('PATCH', `/api/admin/workspaces/${'00000000-0000-0000-0000-000000000000'}/subscription`, { planKey: 'agency' })).status).toBe(404);
  });
});

describe('OAuth', () => {
  it('connects Gmail with PKCE and a single-use state, storing encrypted tokens', async () => {
    const { client: c, email, workspaceId } = await signUp(app);
    const start = await c.json<{ url: string }>('POST', '/api/integrations/gmail/connect', {});
    expect(start.status).toBe(200);
    const auth = new URL(start.body.url);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('scope')).toContain('gmail.send');
    expect(auth.searchParams.get('access_type')).toBe('offline');
    const state = auth.searchParams.get('state')!;
    const cb = await c.request('GET', `/api/oauth/google/callback?code=gmail:${encodeURIComponent('mailbox@gmail.test')}&state=${state}`);
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain('connected=mailbox%40gmail.test');
    const [row] = await getDb().select().from(integrations).where(eq(integrations.workspaceId, workspaceId));
    expect(row).toMatchObject({ provider: 'gmail', email: 'mailbox@gmail.test', status: 'active' });
    expect(row.accessTokenEnc).not.toContain('gmail-access-token');
    expect(row.refreshTokenEnc).not.toContain('gmail-refresh-token');
    // The state cannot be replayed.
    const replay = await c.request('GET', `/api/oauth/google/callback?code=gmail:x@gmail.test&state=${state}`);
    expect(replay.headers.location).toContain('error=');
    expect(email).toBeTruthy();
  });

  it('rejects an OAuth callback completed by a different signed-in user', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const start = await alice.client.json<{ url: string }>('POST', '/api/integrations/gmail/connect', {});
    const state = new URL(start.body.url).searchParams.get('state')!;
    const cb = await bob.client.request('GET', `/api/oauth/google/callback?code=gmail:evil@gmail.test&state=${state}`);
    expect(cb.headers.location).toContain('error=');
    const rows = await getDb().select().from(integrations).where(eq(integrations.workspaceId, bob.workspaceId));
    expect(rows).toHaveLength(0);
  });

  it('expires OAuth states after 10 minutes', async () => {
    const { client: c } = await signUp(app);
    const start = await c.json<{ url: string }>('POST', '/api/integrations/gmail/connect', {});
    const state = new URL(start.body.url).searchParams.get('state')!;
    await getDb().update(oauthStates).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(oauthStates.stateHash, sha256(state)));
    const cb = await c.request('GET', `/api/oauth/google/callback?code=gmail:a@gmail.test&state=${state}`);
    expect(cb.headers.location).toContain('error=');
  });

  it('signs in with Google, creating an account and workspace for new users', async () => {
    const c = client(app);
    const start = await c.request('GET', '/api/auth/google');
    expect(start.statusCode).toBe(302);
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const newEmail = `google.${Date.now()}@gmail.test`;
    const cb = await c.request('GET', `/api/oauth/google/callback?code=login:${encodeURIComponent(newEmail)}&state=${state}`);
    expect(cb.headers.location).toContain('/onboarding');
    const me = await c.json<{ user: { email: string; emailVerified: boolean; hasPassword: boolean } }>('GET', '/api/me');
    expect(me.body.user).toMatchObject({ email: newEmail, emailVerified: true, hasPassword: false });
  });

  it('requires a verified email before connecting a mailbox', async () => {
    const { client: c } = await signUp(app, { verified: false });
    const res = await c.json<{ error: { code: string } }>('POST', '/api/integrations/gmail/connect', {});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });
});

describe('templates and personalization', () => {
  it('renders variables with prospect values, fallbacks and the unsubscribe footer', async () => {
    const { client: c } = await signUp(app);
    await c.json('PATCH', '/api/workspace', { defaultSenderName: 'Alex', agencyName: 'Alex Studio', postalAddress: '1 Main Rd' });
    const p = await c.json<{ id: string }>('POST', '/api/prospects', { name: 'Harbour Cuts', locationLabel: 'Sea Point', email: 'x@harbour.test' });
    const res = await c.json<{ subject: string; body: string; missing: string[] }>('POST', '/api/preview', { prospectId: p.body.id, subject: 'Idea for {{businessName}}', body: 'Hi {{firstName|there}}, {{businessName}} in {{location}}. From {{senderName}} at {{agencyName}}.' });
    expect(res.body.subject).toBe('Idea for Harbour Cuts');
    expect(res.body.body).toContain('Hi there, Harbour Cuts in Sea Point. From Alex at Alex Studio.');
    expect(res.body.body).toContain('1 Main Rd');
    expect(res.body.body).toMatch(/unsubscribe here/);
    expect(res.body.missing).toEqual([]);
  });

  it('creates, updates, duplicates and deletes templates', async () => {
    const { client: c } = await signUp(app);
    const created = await c.json<{ template: { id: string } }>('POST', '/api/templates', { name: 'T', subject: 'S', body: 'B', kind: 'follow_up', defaultDelayDays: 5 });
    const id = created.body.template.id;
    expect((await c.json('PUT', `/api/templates/${id}`, { name: 'T2', subject: 'S2', body: 'B2', kind: 'follow_up', defaultDelayDays: 4 })).status).toBe(200);
    const dup = await c.json<{ template: { name: string } }>('POST', `/api/templates/${id}/duplicate`);
    expect(dup.body.template.name).toBe('T2 (copy)');
    expect((await c.json('DELETE', `/api/templates/${id}`)).status).toBe(200);
  });
});

describe('settings, API keys and exports', () => {
  it('updates profile and workspace settings with validation', async () => {
    const { client: c } = await signUp(app);
    expect((await c.json('PATCH', '/api/me/profile', { name: 'New Name', timezone: 'Not/AZone' })).status).toBe(400);
    const ok = await c.json<{ user: { name: string; timezone: string } }>('PATCH', '/api/me/profile', { name: 'New Name', timezone: 'Europe/London', distanceUnit: 'mi' });
    expect(ok.body.user).toMatchObject({ name: 'New Name', timezone: 'Europe/London' });
    const ws = await c.json<{ workspace: { settings: { signature: string; defaultRadiusMeters: number } } }>('PATCH', '/api/workspace', { signature: 'Cheers', defaultRadiusMeters: 25_000 });
    expect(ws.body.workspace.settings).toMatchObject({ signature: 'Cheers', defaultRadiusMeters: 25_000 });
  });

  it('changes the password and requires the current password', async () => {
    const { client: c, email } = await signUp(app);
    expect((await c.json('POST', '/api/auth/change-password', { currentPassword: 'wrong-password-1', newPassword: 'a-new-password-55' })).status).toBe(401);
    expect((await c.json('POST', '/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'a-new-password-55' })).status).toBe(200);
    expect((await client(app).json('POST', '/api/auth/signin', { email, password: 'a-new-password-55' })).status).toBe(200);
  });

  it('issues API keys shown once, stores only a hash, and enforces read-only scope', async () => {
    const { client: c, workspaceId } = await signUp(app);
    const denied = await c.json<{ error: { code: string } }>('POST', '/api/api-keys', { name: 'k', scope: 'read' });
    expect(denied.body.error.code).toBe('LIMIT_REACHED');
    await getDb().update(subscriptions).set({ planKey: 'agency', status: 'active' }).where(eq(subscriptions.workspaceId, workspaceId));
    const created = await c.json<{ key: string; id: string }>('POST', '/api/api-keys', { name: 'CRM', scope: 'read' });
    expect(created.body.key).toMatch(/^lcl_/);
    const list = await c.json<{ keys: Record<string, unknown>[] }>('GET', '/api/api-keys');
    expect(JSON.stringify(list.body)).not.toContain(created.body.key);
    const res = await app.inject({ method: 'GET', url: '/api/v1/prospects', headers: { authorization: `Bearer ${created.body.key}` } });
    expect(res.statusCode).toBe(200);
    const write = await app.inject({ method: 'POST', url: '/api/v1/prospects', headers: { authorization: `Bearer ${created.body.key}` } });
    expect([403, 404]).toContain(write.statusCode);
    await c.json('DELETE', `/api/api-keys/${created.body.id}`);
    const revoked = await app.inject({ method: 'GET', url: '/api/v1/prospects', headers: { authorization: `Bearer ${created.body.key}` } });
    expect(revoked.statusCode).toBe(401);
  });

  it('exports only user data and place IDs, with CSV formula injection neutralized', async () => {
    const { client: c } = await signUp(app);
    await c.json('POST', '/api/prospects', { name: '=HYPERLINK("evil")', email: 'a@b.test' });
    const res = await c.request('GET', '/api/prospects/export?format=csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain(`"'=HYPERLINK(""evil"")"`);
    expect(res.body.split('\r\n')[0]).toContain('google_place_id');
  });

  it('updates notification preferences', async () => {
    const { client: c, userId } = await signUp(app);
    const res = await c.json<{ preferences: { replies: { email: boolean } } }>('PUT', '/api/me/notification-preferences', { replies: { inApp: true, email: false } });
    expect(res.body.preferences.replies.email).toBe(false);
    const [u] = await getDb().select().from(users).where(eq(users.id, userId));
    expect(u.notificationPreferences?.replies.email).toBe(false);
  });

  it('never exposes stack traces in error responses', async () => {
    const { client: c } = await signUp(app);
    const res = await c.request('GET', '/api/prospects/not-a-uuid');
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/at .*\(|node_modules|stack/i);
  });
});
