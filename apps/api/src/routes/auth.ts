import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '@localy/config';
import { getDb, sessions, users } from '@localy/database';
import { eq } from 'drizzle-orm';
import { changePasswordSchema, emailSchema, signInSchema, signUpSchema, PASSWORD_MAX_LENGTH } from '@localy/shared';
import { AppError, admin, audit, auth, oauth, verifyPassword, workspaces } from '@localy/core';
import { parse } from '../http';
import { clearSessionCookie, setSessionCookie } from '../plugins/auth';

const strictLimit = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };
const mediumLimit = { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } };

export default async function authRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post('/api/auth/signup', strictLimit, async (req, reply) => {
    const settings = await admin.getSystemSettings(db);
    if (!settings.signupsEnabled) throw new AppError('FORBIDDEN', 'New sign-ups are temporarily closed.');
    const input = parse(signUpSchema, req.body);
    const { user, session } = await auth.signUp(req.actor, input);
    setSessionCookie(reply, session.token, session.expiresAt);
    return reply.code(201).send({ user: auth.toSessionUser(user) });
  });

  app.post('/api/auth/signin', strictLimit, async (req, reply) => {
    const input = parse(signInSchema, req.body);
    const { user, session, twoFactorRequired } = await auth.signIn(req.actor, input);
    setSessionCookie(reply, session.token, session.expiresAt);
    return { twoFactorRequired, user: twoFactorRequired ? null : auth.toSessionUser(user) };
  });

  app.post('/api/auth/two-factor', strictLimit, async (req) => {
    const { code } = parse(z.object({ code: z.string().trim().min(6).max(20) }), req.body);
    if (!req.session || !req.user) throw new AppError('UNAUTHENTICATED', 'Your sign-in session expired. Please sign in again.');
    await auth.verifyTwoFactorLogin({ ...req.actor, userId: req.user.id, userEmail: req.user.email }, req.session, req.user, code);
    return { user: auth.toSessionUser(req.user) };
  });

  app.post('/api/auth/signout', async (req, reply) => {
    if (req.session) {
      await auth.revokeSession(db, req.session.id);
      await audit(db, req.actor, { action: 'auth.logout', targetType: 'session', targetId: req.session.id });
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post('/api/auth/forgot-password', strictLimit, async (req) => {
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    await auth.requestPasswordReset(req.actor, email);
    return { ok: true };
  });

  app.post('/api/auth/reset-password', strictLimit, async (req) => {
    const { token, password } = parse(z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(PASSWORD_MAX_LENGTH) }), req.body);
    await auth.resetPassword(req.actor, token, password);
    return { ok: true };
  });

  app.post('/api/auth/verify-email', mediumLimit, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    const res = await auth.verifyEmail(req.actor, token);
    return { ok: true, email: res.email };
  });

  app.post('/api/auth/resend-verification', { ...strictLimit, preHandler: app.requireUser }, async (req) => {
    await auth.sendVerificationEmail(db, req.user!);
    return { ok: true };
  });

  // OAuth sign-in with Google
  app.get('/api/auth/google', mediumLimit, async (req, reply) => {
    const { redirect } = parse(z.object({ redirect: z.string().max(300).optional() }), req.query);
    const url = await oauth.createAuthorizationUrl(db, { purpose: 'login', redirectTo: redirect ?? null });
    return reply.redirect(url);
  });

  // Sessions & security
  app.get('/api/auth/sessions', { preHandler: app.requireUser }, async (req) => ({ sessions: await auth.listSessions(db, req.user!.id, req.session!.id) }));

  app.delete('/api/auth/sessions/:id', { preHandler: app.requireUser }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const [s] = await db.select().from(sessions).where(eq(sessions.id, id));
    if (!s || s.userId !== req.user!.id) throw new AppError('NOT_FOUND', 'Session not found.');
    await auth.revokeSession(db, id);
    await audit(db, req.actor, { action: 'auth.session_revoked', targetType: 'session', targetId: id });
    return { ok: true };
  });

  app.post('/api/auth/sessions/revoke-others', { preHandler: app.requireUser }, async (req) => {
    const n = await auth.revokeOtherSessions(db, req.user!.id, req.session!.id);
    await audit(db, req.actor, { action: 'auth.logout_all', metadata: { revoked: n } });
    return { revoked: n };
  });

  app.post('/api/auth/change-password', { ...strictLimit, preHandler: app.requireUser }, async (req) => {
    const input = parse(changePasswordSchema, req.body);
    return auth.changePassword({ ...req.actor, userId: req.user!.id }, req.user!, req.session!.id, input.currentPassword, input.newPassword);
  });

  app.post('/api/auth/change-email', { ...strictLimit, preHandler: app.requireUser }, async (req) => {
    const input = parse(z.object({ email: emailSchema, password: z.string().max(PASSWORD_MAX_LENGTH).optional() }), req.body);
    await auth.requestEmailChange({ ...req.actor, userId: req.user!.id }, req.user!, input.email, input.password);
    return { ok: true };
  });

  app.post('/api/auth/two-factor/setup', { preHandler: app.requireUser }, async (req) => auth.beginTwoFactorSetup(db, req.user!));

  app.post('/api/auth/two-factor/enable', { ...strictLimit, preHandler: app.requireUser }, async (req) => {
    const { code } = parse(z.object({ code: z.string().trim().min(6).max(8) }), req.body);
    const [fresh] = await db.select().from(users).where(eq(users.id, req.user!.id));
    return auth.confirmTwoFactorSetup(req.actor, fresh, code);
  });

  app.post('/api/auth/two-factor/disable', { ...strictLimit, preHandler: app.requireUser }, async (req) => {
    const input = parse(z.object({ password: z.string().max(PASSWORD_MAX_LENGTH).optional(), code: z.string().max(8).optional() }), req.body);
    await auth.disableTwoFactor(req.actor, req.user!, input.password, input.code);
    return { ok: true };
  });

  app.post('/api/auth/two-factor/recovery-codes', { ...strictLimit, preHandler: app.requireUser }, async (req) => {
    const input = parse(z.object({ password: z.string().max(PASSWORD_MAX_LENGTH).optional() }), req.body);
    return auth.regenerateRecoveryCodes(req.actor, req.user!, input.password);
  });

  app.get('/api/auth/two-factor/status', { preHandler: app.requireUser }, async (req) => ({
    enabled: Boolean(req.user!.twoFactorEnabledAt),
    recoveryCodesRemaining: await auth.remainingRecoveryCodes(db, req.user!.id),
  }));

  // Invitations
  app.get('/api/invitations/:token', mediumLimit, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.params);
    return workspaces.describeInvitation(db, token);
  });

  app.post('/api/invitations/:token/accept', { preHandler: app.requireUser }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.params);
    const res = await workspaces.acceptInvitation({ ...req.actor, userId: req.user!.id }, token, req.user!.email);
    await workspaces.switchWorkspace(db, req.session!.id, req.user!.id, res.workspaceId);
    return res;
  });

  // Platform admin re-authentication (separate from workspace roles)
  app.post('/api/admin/elevate', { ...strictLimit, preHandler: app.requireUser }, async (req) => {
    if (!req.user!.isPlatformAdmin) throw new AppError('NOT_FOUND', 'Not found.');
    const { password } = parse(z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH) }), req.body);
    if (!(await verifyPassword(req.user!.passwordHash, password))) throw new AppError('UNAUTHENTICATED', 'Incorrect password.');
    const until = new Date(Date.now() + 30 * 60 * 1000);
    await db.update(sessions).set({ adminElevatedUntil: until }).where(eq(sessions.id, req.session!.id));
    await audit(db, req.actor, { action: 'admin.elevated' });
    return { until: until.toISOString() };
  });

  void getConfig;
}
