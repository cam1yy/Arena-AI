import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getConfig } from '@localy/config';
import { getDb } from '@localy/database';
import { AppError, auth, integrations, logger, oauth } from '@localy/core';
import { parse } from '../http';
import { setSessionCookie } from '../plugins/auth';

function appRedirect(reply: FastifyReply, path: string, params: Record<string, string> = {}) {
  const url = new URL(path, getConfig().APP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return reply.redirect(url.toString());
}

function friendly(err: unknown) {
  if (err instanceof AppError) return err.message;
  logger.error({ err }, 'oauth callback failed');
  return 'Something went wrong while connecting. Please try again.';
}

export default async function oauthRoutes(app: FastifyInstance) {
  const db = getDb();
  const cbSchema = z.object({ code: z.string().max(4000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional(), error_description: z.string().max(500).optional() });

  const handle = async (provider: 'google' | 'microsoft', query: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const q = parse(cbSchema, query);
    if (!q.state) return appRedirect(reply, '/signin', { error: 'The sign-in link was incomplete. Please try again.' });
    let purpose: string | null = null;
    try {
      if (q.error) {
        await oauth.consumeState(db, q.state).catch(() => null);
        const denied = q.error === 'access_denied';
        return appRedirect(reply, '/app/integrations', { error: denied ? 'Access was not granted, so nothing was connected.' : 'The provider returned an error. Please try again.' });
      }
      if (!q.code) throw new AppError('BAD_REQUEST', 'The provider did not return an authorization code.');
      // Peek at the state's purpose without consuming it (consumption happens in the service).
      const { oauthStates } = await import('@localy/database');
      const { eq } = await import('drizzle-orm');
      const { sha256 } = await import('@localy/core');
      const [st] = await db.select({ purpose: oauthStates.purpose }).from(oauthStates).where(eq(oauthStates.stateHash, sha256(q.state)));
      if (!st) throw new AppError('BAD_REQUEST', 'This authorization link has expired. Please try again.');
      purpose = st.purpose;

      if (purpose === 'login') {
        if (provider !== 'google') throw new AppError('BAD_REQUEST', 'Unsupported sign-in provider.');
        const stRow = await oauth.consumeState(db, q.state);
        const tokens = await oauth.exchangeGoogleCode(q.code, stRow.codeVerifier);
        const claims = oauth.googleClaims(tokens);
        const result = await auth.signInWithOAuth(req.actor, {
          provider: 'google',
          providerAccountId: claims.sub,
          email: claims.email,
          emailVerified: Boolean(claims.email_verified),
          name: claims.name ?? '',
          avatarUrl: claims.picture ?? null,
        });
        setSessionCookie(reply, result.session.token, result.session.expiresAt);
        if (result.twoFactorRequired) return appRedirect(reply, '/signin', { step: 'two-factor' });
        return appRedirect(reply, result.created ? '/onboarding' : (stRow.redirectTo ?? '/app'));
      }

      if (!req.user || req.session?.twoFactorPending) throw new AppError('UNAUTHENTICATED', 'Sign in to Localy before connecting a mailbox.');
      const { integration, redirectTo } = await integrations.completeMailboxOAuth({ ...req.actor, userId: req.user.id }, provider, q.code, q.state);
      return appRedirect(reply, redirectTo ?? '/app/integrations', { connected: integration.email });
    } catch (err) {
      const target = purpose === 'login' ? '/signin' : '/app/integrations';
      return appRedirect(reply, target, { error: friendly(err) });
    }
  };

  app.get('/api/oauth/google/callback', async (req, reply) => handle('google', req.query, req, reply));
  app.get('/api/oauth/microsoft/callback', async (req, reply) => handle('microsoft', req.query, req, reply));
}
