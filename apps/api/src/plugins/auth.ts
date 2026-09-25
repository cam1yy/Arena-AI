import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { getConfig } from '@localy/config';
import { getDb, type users } from '@localy/database';
import type { Role } from '@localy/shared';
import { AppError, apiKeys, auth, workspaces, type ActorContext, type WorkspaceContext } from '@localy/core';

type UserRow = typeof users.$inferSelect;
type SessionRow = Awaited<ReturnType<typeof auth.resolveSession>> extends infer R ? (R extends { session: infer S } ? S : never) : never;

declare module 'fastify' {
  interface FastifyRequest {
    sessionToken: string | null;
    session: SessionRow | null;
    user: UserRow | null;
    actor: ActorContext;
    /** Set by requireWorkspace. */
    wctx: WorkspaceContext;
  }
  interface FastifyInstance {
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireVerifiedUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireWorkspace: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePlatformAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const SESSION_COOKIE = auth.SESSION_COOKIE;
export const CSRF_HEADER = 'x-localy-csrf';

export function sessionCookieOptions(expires?: Date) {
  const cfg = getConfig();
  const crossSite = cfg.COOKIE_SAMESITE === 'none';
  return {
    path: '/',
    httpOnly: true,
    // SameSite=None requires Secure; browsers treat localhost as secure.
    secure: cfg.cookieSecure || crossSite,
    sameSite: cfg.COOKIE_SAMESITE,
    partitioned: crossSite && cfg.COOKIE_PARTITIONED ? true : undefined,
    domain: cfg.COOKIE_DOMAIN,
    expires,
  };
}

export function setSessionCookie(reply: FastifyReply, token: string, expires: Date) {
  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expires));
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Authentication and authorization.
 *  - Sessions: opaque random token in an HttpOnly, SameSite=Lax cookie; only a
 *    SHA-256 hash is stored server-side.
 *  - CSRF: every state-changing, cookie-authenticated request must carry the
 *    custom X-Localy-CSRF header (which cross-site forms cannot set) and, when
 *    present, an Origin matching the app. Webhooks and API keys are exempt.
 *  - Workspace access: resolved from the session's active workspace and
 *    re-verified against workspace_members on every request.
 */
export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('sessionToken', null);
  app.decorateRequest('session', null);
  app.decorateRequest('user', null);
  app.decorateRequest('actor', null as unknown as ActorContext);
  app.decorateRequest('wctx', null as unknown as WorkspaceContext);

  app.addHook('onRequest', async (req) => {
    const db = getDb();
    req.actor = { db, userId: null, ip: req.ip, userAgent: req.headers['user-agent'] ?? null, requestId: req.id };
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const resolved = await auth.resolveSession(db, token);
      if (resolved) {
        req.sessionToken = token;
        req.session = resolved.session;
        req.user = resolved.user;
        if (!resolved.session.twoFactorPending) {
          req.actor = { ...req.actor, userId: resolved.user.id, userEmail: resolved.user.email };
        }
      }
    }
    const url = req.url.split('?')[0];
    const exempt = url.startsWith('/api/webhooks/') || url.startsWith('/u/') || url.startsWith('/api/oauth/') || url.startsWith('/api/v1/');
    if (STATE_CHANGING.has(req.method) && !exempt && token) {
      if (req.headers[CSRF_HEADER] !== '1') throw new AppError('CSRF_FAILED', 'This request could not be verified. Refresh the page and try again.');
      const origin = req.headers.origin;
      if (origin && origin !== 'null') {
        const allowed = getConfig().corsOrigins.map((o) => o.toLowerCase());
        // Same-host requests are allowed regardless of scheme, because TLS is
        // often terminated by a proxy in front of the API.
        let originHost = '';
        try {
          originHost = new URL(origin).host.toLowerCase();
        } catch {
          /* invalid origin */
        }
        const forwardedHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim().toLowerCase();
        const hosts = [forwardedHost, String(req.headers.host ?? '').toLowerCase()].filter(Boolean);
        if (!allowed.includes(origin.toLowerCase().replace(/\/$/, '')) && !hosts.includes(originHost)) {
          throw new AppError('CSRF_FAILED', 'This request came from an unexpected origin.');
        }
      }
    }
  });

  app.decorate('requireUser', async (req: FastifyRequest) => {
    if (!req.user || !req.session) {
      if (req.cookies?.[SESSION_COOKIE]) throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
      throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
    }
    if (req.session.twoFactorPending) throw new AppError('TWO_FACTOR_REQUIRED', 'Enter your two-factor authentication code to continue.');
  });

  app.decorate('requireVerifiedUser', async (req: FastifyRequest, reply: FastifyReply) => {
    await app.requireUser(req, reply);
    if (!req.user!.emailVerifiedAt) throw new AppError('EMAIL_NOT_VERIFIED', 'Verify your email address to use this feature. Check your inbox for the confirmation link.');
  });

  app.decorate('requireWorkspace', async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    if (!req.user && authHeader?.startsWith('Bearer lcl_')) {
      const key = await apiKeys.resolveApiKey(getDb(), authHeader.slice('Bearer '.length).trim());
      if (!key) throw new AppError('UNAUTHENTICATED', 'Invalid API key.');
      if (key.scope === 'read' && req.method !== 'GET') throw new AppError('FORBIDDEN', 'This API key is read-only.');
      req.wctx = { ...req.actor, userId: key.createdBy, workspaceId: key.workspaceId, role: 'member', apiKeyId: key.id };
      return;
    }
    await app.requireUser(req, reply);
    const db = getDb();
    let workspaceId = req.session!.activeWorkspaceId;
    let role: Role | null = workspaceId ? await workspaces.getMembership(db, workspaceId, req.user!.id) : null;
    if (!role) {
      const list = await workspaces.listUserWorkspaces(db, req.user!.id);
      if (!list.length) throw new AppError('FORBIDDEN', 'You are not a member of any workspace.');
      workspaceId = list[0].id;
      role = list[0].role;
      await workspaces.switchWorkspace(db, req.session!.id, req.user!.id, workspaceId);
    }
    req.wctx = { ...req.actor, workspaceId: workspaceId!, role };
  });

  app.decorate('requirePlatformAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    await app.requireUser(req, reply);
    if (!req.user!.isPlatformAdmin) throw new AppError('NOT_FOUND', 'Not found.');
    const until = req.session!.adminElevatedUntil;
    if (!until || until.getTime() < Date.now()) {
      throw new AppError('ADMIN_REAUTH_REQUIRED', 'Confirm your password to access the admin area.');
    }
  });
});
