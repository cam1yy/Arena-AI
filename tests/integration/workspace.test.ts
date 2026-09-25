import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, prospects, users, workspaceInvitations } from '@localy/database';
import { randomToken, sha256 } from '@localy/core';
import { client, getApp, PASSWORD, signUp } from '../support/harness';

let app: Awaited<ReturnType<typeof getApp>>;
beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

async function createProspect(c: ReturnType<typeof client>, name = 'Isolated Bakery') {
  const res = await c.json<{ id: string }>('POST', '/api/prospects', { name, email: 'owner@bakery.test' });
  expect(res.status).toBe(201);
  return res.body.id;
}

describe('workspace isolation', () => {
  it('never exposes another workspace\'s prospects, notes, campaigns or templates', async () => {
    const alice = await signUp(app, { workspaceName: 'Alice Co' });
    const bob = await signUp(app, { workspaceName: 'Bob Co' });
    const pid = await createProspect(alice.client);
    await alice.client.json('POST', `/api/prospects/${pid}/notes`, { body: 'secret note' });
    const tpl = await alice.client.json<{ template: { id: string } }>('POST', '/api/templates', { name: 'Private', subject: 'S', body: 'B', kind: 'initial', defaultDelayDays: 3 });

    expect((await bob.client.json('GET', `/api/prospects/${pid}`)).status).toBe(404);
    expect((await bob.client.json('PATCH', `/api/prospects/${pid}`, { status: 'client' })).status).toBe(404);
    expect((await bob.client.json('DELETE', `/api/prospects/${pid}`)).status).toBe(404);
    expect((await bob.client.json('POST', `/api/prospects/${pid}/notes`, { body: 'x' })).status).toBe(404);
    expect((await bob.client.json('GET', `/api/templates/${tpl.body.template.id}`)).status).toBe(404);
    const bulk = await bob.client.json('POST', '/api/prospects/bulk', { ids: [pid], action: 'delete' });
    expect(bulk.status).toBe(404);
    const list = await bob.client.json<{ items: unknown[]; total: number }>('GET', '/api/prospects');
    expect(list.body.total).toBe(0);
    const search = await bob.client.json<{ prospects: unknown[]; notes: unknown[] }>('GET', '/api/search?q=secret');
    expect(search.body.notes).toHaveLength(0);
    const [still] = await getDb().select().from(prospects).where(eq(prospects.id, pid));
    expect(still.status).toBe('new');
  });

  it('prevents switching into a workspace the user does not belong to', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const res = await bob.client.json('POST', '/api/workspaces/switch', { workspaceId: alice.workspaceId });
    expect(res.status).toBe(404);
  });

  it('keeps campaign recipients scoped to the campaign workspace', async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    const bobProspect = await createProspect(bob.client, 'Bob Prospect');
    const campaign = await alice.client.json<{ campaign: { id: string } }>('POST', '/api/campaigns', {
      name: 'Alice campaign',
      dailyLimit: 10,
      timezone: 'UTC',
      sendWindowStart: 0,
      sendWindowEnd: 24,
      sendDays: [1, 2, 3, 4, 5, 6, 7],
      stopOnReply: true,
      steps: [{ subject: 'Hi', body: 'Hello', waitDays: 0, enabled: true }],
    });
    const add = await alice.client.json<{ added: number }>('POST', `/api/campaigns/${campaign.body.campaign.id}/recipients`, { prospectIds: [bobProspect] });
    expect(add.body.added).toBe(0);
  });
});

describe('roles and permissions', () => {
  it('lets owners invite members and enforces member restrictions server-side', async () => {
    const owner = await signUp(app, { workspaceName: 'Team Co' });
    // Upgrade seats so the invitation is allowed on the trial plan.
    await getDb().execute(`update subscriptions set limit_overrides = '{"seats": 5}'::jsonb where workspace_id = '${owner.workspaceId}'` as never);
    const member = await signUp(app, { workspaceName: 'Member Personal' });
    const inv = await owner.client.json<{ id: string }>('POST', '/api/workspace/invitations', { email: member.email, role: 'member' });
    expect(inv.status).toBe(200);
    const token = randomToken(32);
    await getDb().update(workspaceInvitations).set({ tokenHash: sha256(token) }).where(eq(workspaceInvitations.id, inv.body.id));
    expect((await member.client.json('POST', `/api/invitations/${token}/accept`)).status).toBe(200);
    const me = await member.client.json<{ workspace: { id: string; role: string } }>('GET', '/api/me');
    expect(me.body.workspace).toMatchObject({ id: owner.workspaceId, role: 'member' });

    // Members can work with prospects...
    expect((await member.client.json('POST', '/api/prospects', { name: 'Shared Prospect' })).status).toBe(201);
    // ...but cannot change workspace settings, invite, manage billing, API keys or export.
    expect((await member.client.json('PATCH', '/api/workspace', { name: 'Hijacked' })).status).toBe(403);
    expect((await member.client.json('POST', '/api/workspace/invitations', { email: 'x@example.test', role: 'member' })).status).toBe(403);
    expect((await member.client.json('POST', '/api/billing/checkout', { plan: 'pro' })).status).toBe(403);
    expect((await member.client.json('POST', '/api/api-keys', { name: 'k', scope: 'read' })).status).toBe(403);
    expect((await member.client.request('GET', '/api/prospects/export')).statusCode).toBe(403);
    expect((await member.client.json('POST', '/api/workspace/delete', { confirmName: 'Team Co' })).status).toBe(403);
    expect((await member.client.json('GET', '/api/audit-logs')).status).toBe(403);
    // Members cannot promote themselves.
    expect((await member.client.json('PATCH', `/api/workspace/members/${member.userId}`, { role: 'admin' })).status).toBe(403);
  });

  it('refuses invitations accepted by a different email address', async () => {
    const owner = await signUp(app);
    await getDb().execute(`update subscriptions set limit_overrides = '{"seats": 5}'::jsonb where workspace_id = '${owner.workspaceId}'` as never);
    const other = await signUp(app);
    const inv = await owner.client.json<{ id: string }>('POST', '/api/workspace/invitations', { email: 'intended@example.test', role: 'member' });
    const token = randomToken(32);
    await getDb().update(workspaceInvitations).set({ tokenHash: sha256(token) }).where(eq(workspaceInvitations.id, inv.body.id));
    expect((await other.client.json('POST', `/api/invitations/${token}/accept`)).status).toBe(403);
  });

  it('enforces seat limits when inviting', async () => {
    const owner = await signUp(app);
    const res = await owner.client.json<{ error: { code: string } }>('POST', '/api/workspace/invitations', { email: 'seat@example.test', role: 'member' });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('LIMIT_REACHED');
  });

  it('keeps platform admin separate from workspace roles and requires re-authentication', async () => {
    const owner = await signUp(app);
    expect((await owner.client.json('GET', '/api/admin/overview')).status).toBe(404);
    await getDb().update(users).set({ isPlatformAdmin: true }).where(eq(users.id, owner.userId));
    const needs = await owner.client.json<{ error: { code: string } }>('GET', '/api/admin/overview');
    expect(needs.body.error.code).toBe('ADMIN_REAUTH_REQUIRED');
    expect((await owner.client.json('POST', '/api/admin/elevate', { password: 'wrong-password-1' })).status).toBe(401);
    expect((await owner.client.json('POST', '/api/admin/elevate', { password: PASSWORD })).status).toBe(200);
    expect((await owner.client.json('GET', '/api/admin/overview')).status).toBe(200);
  });
});

describe('account deletion', () => {
  it('deletes the user and workspaces they own alone, and signs them out', async () => {
    const u = await signUp(app);
    await createProspect(u.client);
    expect((await u.client.json('POST', '/api/me/delete', { confirm: 'nope', password: PASSWORD })).status).toBe(400);
    expect((await u.client.json('POST', '/api/me/delete', { confirm: 'DELETE', password: 'wrong-pass-123' })).status).toBe(401);
    expect((await u.client.json('POST', '/api/me/delete', { confirm: 'DELETE', password: PASSWORD })).status).toBe(200);
    const [row] = await getDb().select().from(users).where(eq(users.id, u.userId));
    expect(row).toBeUndefined();
    const left = await getDb().select().from(prospects).where(eq(prospects.workspaceId, u.workspaceId));
    expect(left).toHaveLength(0);
    expect((await u.client.json('GET', '/api/me')).status).toBe(401);
  });

  it('blocks deletion while the user owns a workspace shared with others', async () => {
    const owner = await signUp(app);
    await getDb().execute(`update subscriptions set limit_overrides = '{"seats": 5}'::jsonb where workspace_id = '${owner.workspaceId}'` as never);
    const member = await signUp(app);
    const inv = await owner.client.json<{ id: string }>('POST', '/api/workspace/invitations', { email: member.email, role: 'member' });
    const token = randomToken(32);
    await getDb().update(workspaceInvitations).set({ tokenHash: sha256(token) }).where(eq(workspaceInvitations.id, inv.body.id));
    await member.client.json('POST', `/api/invitations/${token}/accept`);
    const res = await owner.client.json<{ error: { code: string } }>('POST', '/api/me/delete', { confirm: 'DELETE', password: PASSWORD });
    expect(res.status).toBe(409);
  });
});
