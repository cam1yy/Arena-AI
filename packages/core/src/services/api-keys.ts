import { and, desc, eq, isNull } from 'drizzle-orm';
import { apiKeys, users, type Database } from '@localy/database';
import { notFound } from '../errors';
import { randomToken, sha256 } from '../crypto';
import { audit } from '../audit';
import type { WorkspaceContext } from '../context';
import { assertCan } from '../permissions';
import { getEffectivePlan } from './usage';
import { AppError } from '../errors';

/*
 * Workspace API keys. The full key is shown exactly once at creation; only a
 * SHA-256 hash and a short display prefix are stored.
 */
export async function listApiKeys(ctx: WorkspaceContext) {
  assertCan(ctx, 'apikeys.manage');
  const rows = await ctx.db
    .select({ k: apiKeys, creator: users.name })
    .from(apiKeys)
    .leftJoin(users, eq(users.id, apiKeys.createdBy))
    .where(eq(apiKeys.workspaceId, ctx.workspaceId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map(({ k, creator }) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scope: k.scope,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
    createdBy: creator ?? null,
  }));
}

export async function createApiKey(ctx: WorkspaceContext, input: { name: string; scope: 'read' | 'write' }) {
  assertCan(ctx, 'apikeys.manage');
  const plan = await getEffectivePlan(ctx.db, ctx.workspaceId);
  if (plan.planKey !== 'agency') {
    throw new AppError('LIMIT_REACHED', 'API access is available on the Agency plan.', { details: { upgradeUrl: '/app/billing' } });
  }
  const secret = randomToken(30);
  const key = `lcl_${secret}`;
  const [row] = await ctx.db
    .insert(apiKeys)
    .values({ workspaceId: ctx.workspaceId, createdBy: ctx.userId, name: input.name, prefix: key.slice(0, 12), keyHash: sha256(key), scope: input.scope })
    .returning();
  await audit(ctx.db, ctx, { action: 'apikey.created', workspaceId: ctx.workspaceId, targetType: 'api_key', targetId: row.id, metadata: { name: input.name, scope: input.scope } });
  return { id: row.id, name: row.name, prefix: row.prefix, scope: row.scope, key, createdAt: row.createdAt.toISOString() };
}

export async function revokeApiKey(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, 'apikeys.manage');
  const res = await ctx.db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, ctx.workspaceId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  if (!res.length) throw notFound('API key');
  await audit(ctx.db, ctx, { action: 'apikey.revoked', workspaceId: ctx.workspaceId, targetType: 'api_key', targetId: id });
}

export async function resolveApiKey(db: Database, key: string) {
  if (!key.startsWith('lcl_') || key.length > 100) return null;
  const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt))).limit(1);
  if (!row) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  }
  return row;
}
