import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import { auditLogs, authTokens, closeDb, getDb, sessions, users } from '@localy/database';
import { randomToken, sha256 } from '@localy/core';
import { client, getApp, PASSWORD, signUp, uniqueEmail } from '../support/harness';

let app: Awaited<ReturnType<typeof getApp>>;
beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('authentication', () => {
  it('signs up, creates a workspace with a trial and default templates, and starts a session', async () => {
    const { client: c, workspaceId } = await signUp(app, { workspaceName: 'Acme Studio' });
    const me = await c.json<{ workspace: { name: string; role: string }; billing: { planKey: string; status: string } }>('GET', '/api/me');
    expect(me.status).toBe(200);
    expect(me.body.workspace.name).toBe('Acme Studio');
    expect(me.body.workspace.role).toBe('owner');
    expect(me.body.billing).toMatchObject({ planKey: 'trial', status: 'trialing' });
    const templates = await c.json<{ templates: { kind: string }[] }>('GET', '/api/templates');
    expect(templates.body.templates.filter((t) => t.kind === 'initial')).toHaveLength(1);
    expect(workspaceId).toBeTruthy();
  });

  it('rejects weak passwords with field errors', async () => {
    const c = client(app);
    const res = await c.json<{ error: { code: string; details: { fields: Record<string, string[]> } } }>('POST', '/api/auth/signup', { name: 'A', email: uniqueEmail(), password: 'short', workspaceName: 'W' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.password.length).toBeGreaterThan(0);
  });

  it('rejects duplicate emails case-insensitively', async () => {
    const { email } = await signUp(app);
    const res = await client(app).json<{ error: { code: string } }>('POST', '/api/auth/signup', { name: 'B', email: email.toUpperCase(), password: PASSWORD, workspaceName: 'W' });
    expect(res.status).toBe(409);
  });

  it('stores passwords with argon2id, never in plain text', async () => {
    const { email } = await signUp(app);
    const [u] = await getDb().select().from(users).where(eq(users.email, email));
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u.passwordHash).not.toContain(PASSWORD);
  });

  it('signs in and out, and a signed-out session cannot be reused', async () => {
    const { email } = await signUp(app);
    const c = client(app);
    const bad = await c.json('POST', '/api/auth/signin', { email, password: 'wrong-password-123' });
    expect(bad.status).toBe(401);
    const ok = await c.json<{ twoFactorRequired: boolean }>('POST', '/api/auth/signin', { email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.twoFactorRequired).toBe(false);
    const cookie = c.cookie;
    expect((await c.json('GET', '/api/me')).status).toBe(200);
    await c.json('POST', '/api/auth/signout');
    const stale = client(app);
    stale.cookie = cookie;
    const res = await stale.json<{ error: { code: string } }>('GET', '/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('expires sessions past their expiry time', async () => {
    const { client: c, userId } = await signUp(app);
    await getDb().update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, userId));
    expect((await c.json('GET', '/api/me')).status).toBe(401);
  });

  it('supports multiple devices and signing out all other devices', async () => {
    const { email, client: first } = await signUp(app);
    const second = client(app);
    await second.json('POST', '/api/auth/signin', { email, password: PASSWORD });
    const list = await first.json<{ sessions: { current: boolean }[] }>('GET', '/api/auth/sessions');
    expect(list.body.sessions.length).toBe(2);
    const res = await first.json<{ revoked: number }>('POST', '/api/auth/sessions/revoke-others');
    expect(res.body.revoked).toBe(1);
    expect((await second.json('GET', '/api/me')).status).toBe(401);
    expect((await first.json('GET', '/api/me')).status).toBe(200);
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const { client: c } = await signUp(app);
    const res = await c.request('POST', '/api/tags', { name: 'x' }, { 'x-localy-csrf': '' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CSRF_FAILED');
    const foreign = await c.request('POST', '/api/tags', { name: 'x' }, { origin: 'https://evil.example' });
    expect(foreign.statusCode).toBe(403);
  });

  it('verifies email with a single-use token', async () => {
    const { email } = await signUp(app, { verified: false });
    const [u] = await getDb().select().from(users).where(eq(users.email, email));
    const token = randomToken(32);
    await getDb().insert(authTokens).values({ userId: u.id, email, type: 'email_verification', tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60_000) });
    const c = client(app);
    expect((await c.json('POST', '/api/auth/verify-email', { token })).status).toBe(200);
    const [after] = await getDb().select().from(users).where(eq(users.id, u.id));
    expect(after.emailVerifiedAt).not.toBeNull();
    // Re-opening the same link (second tab, mail client preview) is harmless once verified...
    expect((await c.json('POST', '/api/auth/verify-email', { token })).status).toBe(200);
    // ...but a used token can never verify an account that is not already verified.
    await getDb().update(users).set({ emailVerifiedAt: null }).where(eq(users.id, u.id));
    expect((await c.json('POST', '/api/auth/verify-email', { token })).status).toBe(400);
    const [still] = await getDb().select().from(users).where(eq(users.id, u.id));
    expect(still.emailVerifiedAt).toBeNull();
    // Unknown and expired tokens are rejected.
    expect((await c.json('POST', '/api/auth/verify-email', { token: randomToken(32) })).status).toBe(400);
  });

  it('resets a password, revokes all sessions, and does not reveal unknown emails', async () => {
    const { email, userId, client: c } = await signUp(app);
    const unknown = await client(app).json('POST', '/api/auth/forgot-password', { email: uniqueEmail('nobody') });
    expect(unknown.status).toBe(200);
    expect((await client(app).json('POST', '/api/auth/forgot-password', { email })).status).toBe(200);
    const [row] = await getDb().select().from(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.type, 'password_reset'))).orderBy(desc(authTokens.createdAt));
    expect(row).toBeTruthy();
    // The emailed token is random; simulate the user clicking by issuing a known one.
    const token = randomToken(32);
    await getDb().update(authTokens).set({ tokenHash: sha256(token) }).where(eq(authTokens.id, row.id));
    const res = await client(app).json('POST', '/api/auth/reset-password', { token, password: 'a-brand-new-password-9' });
    expect(res.status).toBe(200);
    expect((await c.json('GET', '/api/me')).status).toBe(401);
    expect((await client(app).json('POST', '/api/auth/signin', { email, password: 'a-brand-new-password-9' })).status).toBe(200);
    expect((await client(app).json('POST', '/api/auth/reset-password', { token, password: 'another-password-77' })).status).toBe(400);
  });

  it('enforces two-factor authentication with TOTP and recovery codes', async () => {
    const { email, client: c } = await signUp(app);
    const setup = await c.json<{ secret: string }>('POST', '/api/auth/two-factor/setup');
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.body.secret), digits: 6, period: 30 });
    const enable = await c.json<{ recoveryCodes: string[] }>('POST', '/api/auth/two-factor/enable', { code: totp.generate() });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(10);

    const d = client(app);
    const signIn = await d.json<{ twoFactorRequired: boolean }>('POST', '/api/auth/signin', { email, password: PASSWORD });
    expect(signIn.body.twoFactorRequired).toBe(true);
    const blocked = await d.json<{ error: { code: string } }>('GET', '/api/me');
    expect(blocked.body.error.code).toBe('TWO_FACTOR_REQUIRED');
    expect((await d.json('POST', '/api/auth/two-factor', { code: '000000' })).status).toBe(401);
    expect((await d.json('POST', '/api/auth/two-factor', { code: totp.generate() })).status).toBe(200);
    expect((await d.json('GET', '/api/me')).status).toBe(200);

    const e = client(app);
    await e.json('POST', '/api/auth/signin', { email, password: PASSWORD });
    const code = enable.body.recoveryCodes[0];
    expect((await e.json('POST', '/api/auth/two-factor', { code })).status).toBe(200);
    const f = client(app);
    await f.json('POST', '/api/auth/signin', { email, password: PASSWORD });
    expect((await f.json('POST', '/api/auth/two-factor', { code })).status).toBe(401);
  });

  it('writes audit logs for logins and failed logins', async () => {
    const { email, userId } = await signUp(app);
    await client(app).json('POST', '/api/auth/signin', { email, password: 'nope-nope-123' });
    await client(app).json('POST', '/api/auth/signin', { email, password: PASSWORD });
    const rows = await getDb().select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.userId, userId));
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('auth.sign_up');
    expect(actions).toContain('auth.login');
    expect(actions).toContain('auth.login_failed');
  });

  it('rate limits repeated sign-in attempts', async () => {
    const c = client(app);
    const email = uniqueEmail('ratelimit');
    let limited = false;
    for (let i = 0; i < 14; i++) {
      const res = await c.request('POST', '/api/auth/signin', { email, password: 'wrong-password-1' }, { 'x-forwarded-for': '203.0.113.77' });
      if (res.statusCode === 429) {
        limited = true;
        expect(JSON.parse(res.body).error.code).toBe('RATE_LIMITED');
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
