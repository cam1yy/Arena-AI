import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@localy/database';
import {
  NOTIFICATION_PREFERENCE_KEYS,
  onboardingSchema,
  profileSchema,
  workspaceSettingsSchema,
  inviteSchema,
  memberRoleSchema,
  type MeResponse,
  PASSWORD_MAX_LENGTH,
} from '@localy/shared';
import { account, auth, notifications, usage, workspaces } from '@localy/core';
import { parse } from '../http';
import { clearSessionCookie } from '../plugins/auth';

export default async function meRoutes(app: FastifyInstance) {
  const db = getDb();

  app.get('/api/me', { preHandler: app.requireWorkspace }, async (req): Promise<MeResponse> => {
    const ctx = req.wctx;
    const [ws, list, plan, unread] = await Promise.all([
      workspaces.getWorkspace(db, ctx.workspaceId),
      workspaces.listUserWorkspaces(db, req.user!.id),
      usage.getEffectivePlan(db, ctx.workspaceId),
      notifications.unreadCount(db, req.user!.id, ctx.workspaceId),
    ]);
    return {
      user: auth.toSessionUser(req.user!),
      workspace: { id: ws.id, name: ws.name, role: ctx.role, settings: workspaces.resolveSettings(ws.settings) },
      workspaces: list,
      billing: plan.billing,
      unreadNotifications: unread,
    };
  });

  app.patch('/api/me/profile', { preHandler: app.requireUser }, async (req) => {
    const input = parse(profileSchema, req.body);
    const u = await account.updateProfile({ ...req.actor, userId: req.user!.id }, input);
    return { user: auth.toSessionUser(u) };
  });

  app.put('/api/me/avatar', { preHandler: app.requireUser, bodyLimit: 400_000 }, async (req) => {
    const { dataUrl } = parse(z.object({ dataUrl: z.string().max(360_000).nullable() }), req.body);
    await account.updateAvatar({ ...req.actor, userId: req.user!.id }, dataUrl);
    return { ok: true };
  });

  app.get('/api/me/notification-preferences', { preHandler: app.requireUser }, async (req) => ({
    preferences: notifications.resolvePreferences(req.user!.notificationPreferences),
  }));

  app.put('/api/me/notification-preferences', { preHandler: app.requireUser }, async (req) => {
    const pref = z.object({ inApp: z.boolean(), email: z.boolean() });
    const schema = z.object(Object.fromEntries(NOTIFICATION_PREFERENCE_KEYS.map((k) => [k, pref.optional()])) as Record<(typeof NOTIFICATION_PREFERENCE_KEYS)[number], z.ZodOptional<typeof pref>>);
    const input = parse(schema, req.body);
    const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    return { preferences: await account.updateNotificationPreferences({ ...req.actor, userId: req.user!.id }, clean) };
  });

  app.put('/api/me/onboarding', { preHandler: app.requireWorkspace }, async (req) => {
    const input = parse(onboardingSchema, req.body);
    const ctx = req.wctx;
    const patch: Record<string, unknown> = {};
    if (input.useCase !== undefined) patch.useCase = input.useCase;
    if (input.business) {
      const b = input.business;
      if (b.agencyName !== undefined) patch.agencyName = b.agencyName || null;
      if (b.website !== undefined) patch.website = b.website || null;
      if (b.industry !== undefined) patch.industry = b.industry || null;
      if (b.location !== undefined) patch.businessLocation = b.location || null;
      if (b.senderName !== undefined) patch.defaultSenderName = b.senderName || null;
    }
    if (input.targets) {
      const t = input.targets;
      patch.defaultCategories = t.categories;
      patch.preferredLocations = t.locations;
      patch.defaultLocation = t.locations[0] ?? null;
      patch.minRating = t.minRating;
      patch.maxRating = t.maxRating;
      patch.websiteFilter = t.websiteFilter;
      patch.defaultRadiusMeters = t.radiusMeters;
    }
    // Only owners and admins may change shared workspace settings. Members who
    // joined an existing workspace just record their onboarding progress.
    if (Object.keys(patch).length && (ctx.role === 'owner' || ctx.role === 'admin')) {
      await workspaces.mergeOnboardingSettings(db, ctx.workspaceId, patch);
    }
    const [u] = await db
      .update(users)
      .set({ onboardingStep: Math.max(input.step, req.user!.onboardingStep), ...(input.complete ? { onboardingCompletedAt: new Date() } : {}) })
      .where(eq(users.id, req.user!.id))
      .returning();
    return { user: auth.toSessionUser(u) };
  });

  app.post('/api/me/delete', { preHandler: app.requireUser, config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const input = parse(z.object({ password: z.string().max(PASSWORD_MAX_LENGTH).optional(), confirm: z.string() }), req.body);
    await account.deleteAccount({ ...req.actor, userId: req.user!.id }, req.user!, input);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/me/export', { preHandler: app.requireWorkspace }, async (req, reply) => {
    const data = await account.exportAccountData(req.wctx, req.user!);
    reply.header('Content-Disposition', `attachment; filename="localy-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return data;
  });

  // Workspaces
  app.post('/api/workspaces', { preHandler: app.requireUser }, async (req) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(100) }), req.body);
    const ws = await workspaces.createAdditionalWorkspace({ ...req.actor, userId: req.user!.id }, name);
    await workspaces.switchWorkspace(db, req.session!.id, req.user!.id, ws.id);
    return { id: ws.id, name: ws.name };
  });

  app.post('/api/workspaces/switch', { preHandler: app.requireUser }, async (req) => {
    const { workspaceId } = parse(z.object({ workspaceId: z.string().uuid() }), req.body);
    const role = await workspaces.switchWorkspace(db, req.session!.id, req.user!.id, workspaceId);
    return { workspaceId, role };
  });

  app.patch('/api/workspace', { preHandler: app.requireWorkspace }, async (req) => {
    const input = parse(workspaceSettingsSchema, req.body);
    const ws = await workspaces.updateWorkspaceSettings(req.wctx, input as Parameters<typeof workspaces.updateWorkspaceSettings>[1]);
    return { workspace: { id: ws.id, name: ws.name, settings: ws.settings } };
  });

  app.post('/api/workspace/delete', { preHandler: app.requireWorkspace }, async (req) => {
    const { confirmName } = parse(z.object({ confirmName: z.string() }), req.body);
    await account.deleteWorkspace(req.wctx, confirmName);
    return { ok: true };
  });

  app.get('/api/workspace/members', { preHandler: app.requireWorkspace }, async (req) => workspaces.listMembers(req.wctx));

  app.post('/api/workspace/invitations', { preHandler: app.requireWorkspace }, async (req) => {
    const input = parse(inviteSchema, req.body);
    return workspaces.inviteMember(req.wctx, input as { email: string; role: 'admin' | 'member' });
  });

  app.delete('/api/workspace/invitations/:id', { preHandler: app.requireWorkspace }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await workspaces.revokeInvitation(req.wctx, id);
    return { ok: true };
  });

  app.patch('/api/workspace/members/:userId', { preHandler: app.requireWorkspace }, async (req) => {
    const { userId } = parse(z.object({ userId: z.string().uuid() }), req.params);
    const { role } = parse(memberRoleSchema, req.body);
    await workspaces.changeMemberRole(req.wctx, userId, role);
    return { ok: true };
  });

  app.delete('/api/workspace/members/:userId', { preHandler: app.requireWorkspace }, async (req) => {
    const { userId } = parse(z.object({ userId: z.string().uuid() }), req.params);
    await workspaces.removeMember(req.wctx, userId);
    return { ok: true };
  });

  app.get('/api/usage', { preHandler: app.requireWorkspace }, async (req) => ({ usage: await usage.getUsageSummary(db, req.wctx.workspaceId) }));
}
