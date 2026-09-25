import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { getConfig } from '@localy/config';
import {
  campaigns,
  emailMessages,
  integrations,
  users,
  workspaceMembers,
  type Database,
  type DbOrTx,
} from '@localy/database';
import { getProvider, ProviderError, type ProviderCredentials } from '@localy/email';
import type { IntegrationItem } from '@localy/shared';
import { AppError, badRequest, forbidden, notFound } from '../errors';
import { decryptOptional, encryptOptional } from '../crypto';
import { audit } from '../audit';
import type { ActorContext, WorkspaceContext } from '../context';
import { assertCan, can } from '../permissions';
import { logger } from '../logger';
import { externalFetch } from '../http';
import { assertWithinLimit } from './usage';
import { notifyWorkspace } from './notifications';
import {
  consumeState,
  exchangeGoogleCode,
  exchangeMicrosoftCode,
  googleClaims,
  microsoftClaims,
} from './oauth';

type IntegrationRow = typeof integrations.$inferSelect;

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function sentTodayByIntegration(db: DbOrTx, integrationIds: string[]) {
  const map = new Map<string, number>();
  if (!integrationIds.length) return map;
  const rows = await db
    .select({ id: emailMessages.integrationId, n: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(and(inArray(emailMessages.integrationId, integrationIds), eq(emailMessages.direction, 'outbound'), eq(emailMessages.status, 'sent'), gte(emailMessages.sentAt, startOfUtcDay())))
    .groupBy(emailMessages.integrationId);
  for (const r of rows) if (r.id) map.set(r.id, r.n);
  return map;
}

export async function listIntegrations(ctx: WorkspaceContext): Promise<IntegrationItem[]> {
  assertCan(ctx, 'integrations.read');
  const rows = await ctx.db
    .select({ i: integrations, connectedByName: users.name })
    .from(integrations)
    .leftJoin(users, eq(users.id, integrations.connectedBy))
    .where(and(eq(integrations.workspaceId, ctx.workspaceId), ne(integrations.status, 'disconnected')))
    .orderBy(desc(integrations.isDefault), integrations.createdAt);
  const sent = await sentTodayByIntegration(ctx.db, rows.map((r) => r.i.id));
  return rows.map(({ i, connectedByName }) => ({
    id: i.id,
    provider: i.provider,
    email: i.email,
    displayName: i.displayName,
    status: i.status,
    scopes: i.scopes,
    lastError: i.lastError,
    lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
    lastHealthCheckAt: i.lastHealthCheckAt?.toISOString() ?? null,
    dailySendLimit: i.dailySendLimit,
    sentToday: sent.get(i.id) ?? 0,
    isDefault: i.isDefault,
    connectedBy: i.connectedBy ? { id: i.connectedBy, name: connectedByName ?? 'Former member' } : null,
    createdAt: i.createdAt.toISOString(),
  }));
}

export async function getIntegration(db: DbOrTx, workspaceId: string, id: string): Promise<IntegrationRow> {
  const [i] = await db.select().from(integrations).where(and(eq(integrations.id, id), eq(integrations.workspaceId, workspaceId))).limit(1);
  if (!i || i.status === 'disconnected') throw notFound('Mailbox');
  return i;
}

function assertCanManage(ctx: WorkspaceContext, i: IntegrationRow) {
  if (i.connectedBy !== ctx.userId && !can(ctx.role, 'integrations.manage_all')) {
    throw forbidden('Only the person who connected this mailbox, or a workspace admin, can change it.');
  }
}

/** Default daily limits are conservative relative to provider maximums to protect sender reputation. */
const DEFAULT_DAILY_LIMIT: Record<IntegrationRow['provider'], number> = { gmail: 200, microsoft: 200, sandbox: 500 };

async function upsertIntegration(
  db: Database,
  input: {
    workspaceId: string;
    provider: IntegrationRow['provider'];
    email: string;
    displayName: string | null;
    providerAccountId: string | null;
    scopes: string[];
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: Date | null;
    connectedBy: string;
  },
) {
  const [existing] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, input.workspaceId), eq(integrations.provider, input.provider), sql`lower(${integrations.email}) = ${input.email.toLowerCase()}`))
    .limit(1);
  const [{ n: activeCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(integrations)
    .where(and(eq(integrations.workspaceId, input.workspaceId), ne(integrations.status, 'disconnected')));
  const values = {
    displayName: input.displayName,
    providerAccountId: input.providerAccountId,
    scopes: input.scopes,
    accessTokenEnc: encryptOptional(input.accessToken),
    // Keep the existing refresh token if the provider did not issue a new one.
    refreshTokenEnc: input.refreshToken ? encryptOptional(input.refreshToken) : (existing?.refreshTokenEnc ?? null),
    tokenExpiresAt: input.expiresAt,
    status: 'active' as const,
    lastError: null,
    disconnectedAt: null,
    connectedBy: input.connectedBy,
  };
  if (existing) {
    const [row] = await db
      .update(integrations)
      .set({ ...values, isDefault: existing.status === 'disconnected' ? activeCount === 0 : existing.isDefault })
      .where(eq(integrations.id, existing.id))
      .returning();
    return { row, reconnected: true };
  }
  const [row] = await db
    .insert(integrations)
    .values({
      workspaceId: input.workspaceId,
      provider: input.provider,
      email: input.email.toLowerCase(),
      dailySendLimit: DEFAULT_DAILY_LIMIT[input.provider],
      isDefault: activeCount === 0,
      ...values,
    })
    .returning();
  return { row, reconnected: false };
}

export async function assertCanConnectMailbox(ctx: WorkspaceContext) {
  assertCan(ctx, 'integrations.connect');
  await assertWithinLimit(ctx.db, ctx.workspaceId, 'mailboxes', 1);
}

async function ensureMembership(db: Database, workspaceId: string, userId: string) {
  const [m] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!m) throw forbidden('You are no longer a member of this workspace.');
  return m.role;
}

/** Completes a Gmail or Microsoft mailbox connection after the OAuth redirect. */
export async function completeMailboxOAuth(ctx: ActorContext & { userId: string }, provider: 'google' | 'microsoft', code: string, state: string) {
  const st = await consumeState(ctx.db, state);
  const expected = provider === 'google' ? 'gmail' : 'microsoft';
  if (st.purpose !== expected) throw badRequest('This authorization does not match the requested mailbox provider.');
  if (!st.userId || st.userId !== ctx.userId || !st.workspaceId) throw forbidden('This authorization was started by a different account. Please try again.');
  const role = await ensureMembership(ctx.db, st.workspaceId, ctx.userId);
  const wctx: WorkspaceContext = { ...ctx, workspaceId: st.workspaceId, role };

  let email: string;
  let displayName: string | null;
  let providerAccountId: string;
  let tokens;
  if (provider === 'google') {
    tokens = await exchangeGoogleCode(code, st.codeVerifier);
    const claims = googleClaims(tokens);
    email = claims.email;
    displayName = claims.name ?? null;
    providerAccountId = claims.sub;
    const granted = (tokens.scope ?? '').split(' ');
    if (!granted.includes('https://www.googleapis.com/auth/gmail.send')) {
      throw new AppError('INTEGRATION_ERROR', 'Localy needs permission to send email from Gmail. Please reconnect and allow the requested access.');
    }
  } else {
    tokens = await exchangeMicrosoftCode(code, st.codeVerifier);
    const claims = microsoftClaims(tokens);
    const cfg = getConfig();
    const me = await externalFetch<{ mail?: string; userPrincipalName?: string; displayName?: string; id?: string }>({
      service: 'graph',
      operation: 'me',
      url: `${cfg.MICROSOFT_GRAPH_BASE_URL.replace(/\/$/, '')}/v1.0/me?$select=id,mail,userPrincipalName,displayName`,
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      retries: 1,
      workspaceId: st.workspaceId,
    });
    email = (me.data.mail ?? me.data.userPrincipalName ?? claims.email ?? claims.preferred_username ?? '').toLowerCase();
    displayName = me.data.displayName ?? claims.name ?? null;
    providerAccountId = me.data.id ?? claims.oid ?? claims.sub ?? email;
    if (!email) throw new AppError('INTEGRATION_ERROR', 'Microsoft did not return a mailbox address for this account.');
  }

  const [existing] = await ctx.db
    .select({ id: integrations.id, status: integrations.status })
    .from(integrations)
    .where(and(eq(integrations.workspaceId, st.workspaceId), eq(integrations.provider, expected), sql`lower(${integrations.email}) = ${email.toLowerCase()}`))
    .limit(1);
  if (!existing || existing.status === 'disconnected') await assertCanConnectMailbox(wctx);

  const { row, reconnected } = await upsertIntegration(ctx.db, {
    workspaceId: st.workspaceId,
    provider: expected,
    email,
    displayName,
    providerAccountId,
    scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expires_in ? new Date(Date.now() + (tokens.expires_in - 60) * 1000) : null,
    connectedBy: ctx.userId,
  });
  await audit(ctx.db, wctx, { action: 'integration.connected', workspaceId: st.workspaceId, targetType: 'integration', targetId: row.id, metadata: { provider: expected, email, reconnected } });
  return { integration: row, redirectTo: st.redirectTo };
}

/** Development-only mailbox that records sends without delivering them. */
export async function connectSandbox(ctx: WorkspaceContext, email?: string) {
  if (!getConfig().devSandboxEnabled) throw forbidden('The development sandbox mailbox is not available on this server.');
  const [user] = await ctx.db.select().from(users).where(eq(users.id, ctx.userId!));
  const address = (email ?? user.email).toLowerCase();
  const [existing] = await ctx.db
    .select({ id: integrations.id, status: integrations.status })
    .from(integrations)
    .where(and(eq(integrations.workspaceId, ctx.workspaceId), eq(integrations.provider, 'sandbox'), sql`lower(${integrations.email}) = ${address}`))
    .limit(1);
  if (!existing || existing.status === 'disconnected') await assertCanConnectMailbox(ctx);
  const { row } = await upsertIntegration(ctx.db, {
    workspaceId: ctx.workspaceId,
    provider: 'sandbox',
    email: address,
    displayName: user.name,
    providerAccountId: `sandbox:${address}`,
    scopes: ['sandbox.send', 'sandbox.read'],
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    connectedBy: ctx.userId!,
  });
  await audit(ctx.db, ctx, { action: 'integration.connected', workspaceId: ctx.workspaceId, targetType: 'integration', targetId: row.id, metadata: { provider: 'sandbox' } });
  return row;
}

export async function disconnectIntegration(ctx: WorkspaceContext, id: string) {
  const i = await getIntegration(ctx.db, ctx.workspaceId, id);
  assertCanManage(ctx, i);
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(integrations)
      .set({ status: 'disconnected', accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, isDefault: false, disconnectedAt: new Date() })
      .where(eq(integrations.id, id));
    await pauseCampaignsForIntegration(tx, id, 'The sending mailbox was disconnected. Connect a mailbox and resume the campaign.');
    if (i.isDefault) {
      const [next] = await tx
        .select({ id: integrations.id })
        .from(integrations)
        .where(and(eq(integrations.workspaceId, ctx.workspaceId), eq(integrations.status, 'active')))
        .limit(1);
      if (next) await tx.update(integrations).set({ isDefault: true }).where(eq(integrations.id, next.id));
    }
  });
  await revokeProviderToken(i).catch((err) => logger.warn({ err }, 'token revocation failed'));
  await audit(ctx.db, ctx, { action: 'integration.disconnected', workspaceId: ctx.workspaceId, targetType: 'integration', targetId: id, metadata: { provider: i.provider, email: i.email } });
}

async function revokeProviderToken(i: IntegrationRow) {
  if (i.provider !== 'gmail') return;
  const token = decryptOptional(i.refreshTokenEnc) ?? decryptOptional(i.accessTokenEnc);
  if (!token) return;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', signal: AbortSignal.timeout(5000) });
}

export async function updateIntegrationSettings(ctx: WorkspaceContext, id: string, input: { dailySendLimit?: number; isDefault?: boolean }) {
  const i = await getIntegration(ctx.db, ctx.workspaceId, id);
  assertCanManage(ctx, i);
  await ctx.db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx.update(integrations).set({ isDefault: false }).where(eq(integrations.workspaceId, ctx.workspaceId));
    }
    await tx
      .update(integrations)
      .set({
        ...(input.dailySendLimit ? { dailySendLimit: Math.min(2000, Math.max(1, input.dailySendLimit)) } : {}),
        ...(input.isDefault ? { isDefault: true } : {}),
      })
      .where(eq(integrations.id, id));
  });
  await audit(ctx.db, ctx, { action: 'integration.updated', workspaceId: ctx.workspaceId, targetType: 'integration', targetId: id, metadata: input });
}

export async function pauseCampaignsForIntegration(db: DbOrTx, integrationId: string, reason: string) {
  const paused = await db
    .update(campaigns)
    .set({ status: 'paused', pauseReason: reason })
    .where(and(eq(campaigns.integrationId, integrationId), inArray(campaigns.status, ['active', 'scheduled'])))
    .returning({ id: campaigns.id });
  if (paused.length) {
    await db
      .update(emailMessages)
      .set({ status: 'cancelled', error: 'Campaign paused before this email was sent.' })
      .where(and(inArray(emailMessages.campaignId, paused.map((p) => p.id)), eq(emailMessages.status, 'queued')));
  }
  return paused.length;
}

/** Marks a mailbox as needing reauthorization, pauses its campaigns and notifies admins. */
export async function markIntegrationError(db: Database, i: IntegrationRow, message: string) {
  if (i.status === 'error' && i.lastError === message) return;
  await db.update(integrations).set({ status: 'error', lastError: message }).where(eq(integrations.id, i.id));
  const paused = await pauseCampaignsForIntegration(db, i.id, `The mailbox ${i.email} needs to be reconnected.`);
  await notifyWorkspace(db, i.workspaceId, {
    type: 'integration_disconnected',
    title: `Reconnect ${i.email}`,
    body: `Localy can no longer send from ${i.email}: ${message}${paused ? ` ${paused} campaign${paused === 1 ? ' was' : 's were'} paused.` : ''}`,
    link: '/app/integrations',
    dedupeKey: `integration-error:${i.id}:${new Date().toISOString().slice(0, 10)}`,
    roles: ['owner', 'admin'],
    alsoUserId: i.connectedBy,
  });
}

/** Returns usable credentials, refreshing the access token when needed. */
export async function getFreshCredentials(db: Database, i: IntegrationRow): Promise<ProviderCredentials> {
  const provider = getProvider(i.provider);
  let accessToken = decryptOptional(i.accessTokenEnc);
  const refreshToken = decryptOptional(i.refreshTokenEnc);
  let expiresAt = i.tokenExpiresAt;
  if (i.provider !== 'sandbox' && (!accessToken || !expiresAt || expiresAt.getTime() < Date.now() + 60_000)) {
    if (!refreshToken || !provider.refresh) {
      await markIntegrationError(db, i, 'Authorization expired.');
      throw new ProviderError('Mailbox authorization expired. Reconnect the mailbox.', 'auth');
    }
    try {
      const t = await provider.refresh(refreshToken);
      accessToken = t.accessToken;
      expiresAt = t.expiresAt;
      await db
        .update(integrations)
        .set({ accessTokenEnc: encryptOptional(t.accessToken), refreshTokenEnc: encryptOptional(t.refreshToken), tokenExpiresAt: t.expiresAt, status: 'active', lastError: null })
        .where(eq(integrations.id, i.id));
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'auth') {
        await markIntegrationError(db, i, 'Access was revoked or expired.');
      }
      throw err;
    }
  }
  return { accessToken, refreshToken, expiresAt, email: i.email, syncCursor: i.syncCursor };
}

export async function healthCheckIntegration(db: Database, i: IntegrationRow) {
  const provider = getProvider(i.provider);
  try {
    const creds = await getFreshCredentials(db, i);
    const res = await provider.healthCheck(creds);
    await db
      .update(integrations)
      .set({ lastHealthCheckAt: new Date(), ...(res.ok ? { status: 'active', lastError: null } : {}) })
      .where(eq(integrations.id, i.id));
    if (!res.ok) await markIntegrationError(db, i, res.message ?? 'Health check failed.');
    return res;
  } catch (err) {
    await db.update(integrations).set({ lastHealthCheckAt: new Date() }).where(eq(integrations.id, i.id));
    if (err instanceof ProviderError && err.kind === 'auth') return { ok: false, message: err.message };
    logger.warn({ err, integrationId: i.id }, 'integration health check failed');
    return { ok: false, message: 'The provider could not be reached. Localy will try again later.' };
  }
}

export async function testIntegration(ctx: WorkspaceContext, id: string) {
  const i = await getIntegration(ctx.db, ctx.workspaceId, id);
  return healthCheckIntegration(ctx.db, i);
}

export async function defaultIntegration(db: DbOrTx, workspaceId: string) {
  const [i] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.status, 'active')))
    .orderBy(desc(integrations.isDefault), integrations.createdAt)
    .limit(1);
  return i ?? null;
}
