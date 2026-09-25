import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '@localy/database';
import { SUBSCRIPTION_STATUSES } from '@localy/shared';
import { admin } from '@localy/core';
import { idParam, parse } from '../http';

const limitsSchema = z.object({
  businesses_discovered: z.number().int().min(0),
  places_requests: z.number().int().min(0),
  emails_sent: z.number().int().min(0),
  prospects: z.number().int().min(0),
  active_campaigns: z.number().int().min(0),
  mailboxes: z.number().int().min(0),
  seats: z.number().int().min(1),
});

/** Platform admin API. Guarded by requirePlatformAdmin (is_platform_admin + recent password confirmation). */
export default async function adminRoutes(app: FastifyInstance) {
  const db = getDb();
  app.addHook('preHandler', app.requirePlatformAdmin);
  const page = z.object({ page: z.coerce.number().int().min(1).default(1), q: z.string().max(100).optional() });

  app.get('/api/admin/overview', async () => admin.adminOverview(db));
  app.get('/api/admin/users', async (req) => {
    const q = parse(page, req.query);
    return admin.adminListUsers(db, q.q, q.page);
  });
  app.post('/api/admin/users/:id/disabled', async (req) => {
    const { id } = parse(idParam, req.params);
    const { disabled } = parse(z.object({ disabled: z.boolean() }), req.body);
    await admin.adminSetUserDisabled(db, req.actor, id, disabled);
    return { ok: true };
  });
  app.get('/api/admin/workspaces', async (req) => {
    const q = parse(page, req.query);
    return admin.adminListWorkspaces(db, q.q, q.page);
  });
  app.patch('/api/admin/workspaces/:id/subscription', async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(
      z.object({ planKey: z.string().max(40).optional(), status: z.enum(SUBSCRIPTION_STATUSES).optional(), trialEndsAt: z.string().datetime({ offset: true }).nullable().optional(), limitOverrides: limitsSchema.partial().nullable().optional() }),
      req.body,
    );
    await admin.adminUpdateSubscription(db, req.actor, id, input);
    return { ok: true };
  });
  app.get('/api/admin/campaigns', async (req) => {
    const q = parse(page.extend({ status: z.string().max(20).optional() }), req.query);
    return admin.adminListCampaigns(db, q.status, q.page);
  });
  app.post('/api/admin/campaigns/:id/pause', async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
    await admin.adminPauseCampaign(db, req.actor, id, reason);
    return { ok: true };
  });
  app.get('/api/admin/integrations', async (req) => admin.adminListIntegrations(db, parse(page, req.query).page));
  app.get('/api/admin/api-health', async () => admin.adminApiHealth(db));
  app.get('/api/admin/errors', async (req) => admin.adminErrorLogs(db, parse(page, req.query).page));
  app.get('/api/admin/audit-logs', async (req) => {
    const q = parse(page.extend({ action: z.string().max(60).optional(), workspaceId: z.string().uuid().optional(), userId: z.string().uuid().optional() }), req.query);
    return admin.adminAuditLogs(db, q);
  });
  app.get('/api/admin/settings', async () => admin.getSystemSettings(db));
  app.put('/api/admin/settings', async (req) => {
    const input = parse(
      z.object({ announcement: z.object({ message: z.string().trim().min(1).max(300), level: z.enum(['info', 'warning']) }).nullable().optional(), signupsEnabled: z.boolean().optional(), notifyUsers: z.boolean().optional() }),
      req.body,
    );
    return admin.updateSystemSettings(db, req.actor, input);
  });
  app.get('/api/admin/plans', async () => ({ plans: await admin.adminListPlans(db) }));
  app.put('/api/admin/plans/:key', async (req) => {
    const { key } = parse(z.object({ key: z.string().max(40) }), req.params);
    const input = parse(
      z.object({ name: z.string().trim().min(1).max(60).optional(), description: z.string().max(300).optional(), limits: limitsSchema.optional(), features: z.array(z.string().max(100)).max(20).optional(), stripePriceId: z.string().max(100).nullable().optional(), isActive: z.boolean().optional() }),
      req.body,
    );
    return { plan: await admin.adminUpdatePlan(db, req.actor, key, input) };
  });
}
