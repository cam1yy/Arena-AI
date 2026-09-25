import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { desc } from 'drizzle-orm';
import { getConfig } from '@localy/config';
import { devOutbox, getDb } from '@localy/database';
import { apiKeySchema, type PublicConfig } from '@localy/shared';
import { AppError, admin, analytics, apiKeys, billing, inbox, integrations, notifications, oauth, search } from '@localy/core';
import { idParam, parse, requireVerifiedEmail } from '../http';

export default async function platformRoutes(app: FastifyInstance) {
  const db = getDb();

  app.get('/api/health', async () => {
    await db.execute('select 1' as never);
    return { ok: true, time: new Date().toISOString() };
  });

  app.get('/api/config', async (): Promise<PublicConfig> => {
    const cfg = getConfig();
    const settings = await admin.getSystemSettings(db);
    return {
      appName: 'Localy',
      environment: cfg.NODE_ENV,
      mapsBrowserKey: cfg.GOOGLE_MAPS_BROWSER_KEY ?? null,
      mapsMapId: cfg.GOOGLE_MAPS_MAP_ID ?? null,
      features: {
        places: cfg.features.places,
        maps: cfg.features.maps,
        googleSignIn: cfg.features.googleSignIn,
        gmail: cfg.features.gmail,
        microsoft: cfg.features.microsoft,
        stripe: cfg.features.stripe,
        ai: cfg.features.ai,
        devSandbox: cfg.devSandboxEnabled,
        devMail: !cfg.isProduction && !cfg.features.smtp,
      },
      supportEmail: cfg.SUPPORT_EMAIL,
      announcement: settings.announcement,
      signupsEnabled: settings.signupsEnabled,
    };
  });

  app.get('/api/plans', async () => ({ plans: await billing.listPlans(db) }));

  // Development-only outbox for system email when SMTP is not configured.
  app.get('/api/dev/mail', async () => {
    const cfg = getConfig();
    if (cfg.isProduction || cfg.features.smtp) throw new AppError('NOT_FOUND', 'Not found.');
    const rows = await db.select().from(devOutbox).orderBy(desc(devOutbox.createdAt)).limit(50);
    return { messages: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  });

  // Unsubscribe (public, signed link)
  const unsubscribePage = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111}main{max-width:420px;padding:32px;background:#fff;border:1px solid #e5e5e5;border-radius:10px}h1{font-size:18px;margin:0 0 8px;letter-spacing:-0.01em}p{font-size:14px;line-height:1.6;color:#525252;margin:0}button{margin-top:20px;background:#111;color:#fff;border:0;border-radius:7px;padding:10px 16px;font-size:14px;cursor:pointer}</style></head><body><main>${body.replace('{{title}}', `<h1>${title}</h1>`)}</main></body></html>`;

  app.get('/u/:token', async (req, reply) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(1000) }), req.params);
    reply.type('text/html');
    return unsubscribePage('Unsubscribe', `{{title}}<p>Click below to stop receiving emails from this sender.</p><form method="post"><button type="submit">Unsubscribe</button></form>`).replace('<form method="post">', `<form method="post" action="/u/${encodeURIComponent(token)}">`);
  });

  app.post('/u/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(1000) }), req.params);
    const res = await inbox.unsubscribeByToken(db, token);
    reply.type('text/html');
    if (!res.ok) return reply.code(400).send(unsubscribePage('Link not valid', '{{title}}<p>This unsubscribe link is not valid. Reply to the email and ask to be removed instead.</p>'));
    return unsubscribePage('You have been unsubscribed', '{{title}}<p>You will not receive further emails from this sender.</p>');
  });

  // Authenticated workspace routes
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', app.requireWorkspace);

    scoped.get('/api/dashboard', async (req) => analytics.getDashboard(req.wctx));

    scoped.get('/api/analytics', async (req) => {
      const q = parse(z.object({ range: z.enum(['7d', '30d', '90d', 'all']).default('30d'), campaignId: z.string().uuid().optional() }), req.query);
      return analytics.getAnalytics(req.wctx, q.range, q.campaignId);
    });

    scoped.get('/api/search', async (req) => {
      const { q } = parse(z.object({ q: z.string().max(100).default('') }), req.query);
      return search.globalSearch(req.wctx, q);
    });

    scoped.get('/api/notifications', async (req) => ({
      notifications: await notifications.listNotifications(db, req.user!.id, req.wctx.workspaceId),
      unread: await notifications.unreadCount(db, req.user!.id, req.wctx.workspaceId),
    }));

    scoped.post('/api/notifications/read', async (req) => {
      const input = parse(z.object({ ids: z.union([z.array(z.string().uuid()).max(200), z.literal('all')]) }), req.body);
      await notifications.markRead(db, req.user!.id, input.ids, req.wctx.workspaceId);
      return { ok: true };
    });

    // Integrations
    scoped.get('/api/integrations', async (req) => ({ integrations: await integrations.listIntegrations(req.wctx) }));

    scoped.post('/api/integrations/:provider/connect', async (req) => {
      const { provider } = parse(z.object({ provider: z.enum(['gmail', 'microsoft', 'sandbox']) }), req.params);
      const input = parse(z.object({ redirect: z.string().max(300).optional(), email: z.string().email().optional(), reconnect: z.boolean().optional() }), req.body);
      if (provider !== 'sandbox') requireVerifiedEmail(req);
      if (provider === 'sandbox') {
        const row = await integrations.connectSandbox(req.wctx, input.email);
        return { integrationId: row.id, url: null };
      }
      if (!input.reconnect) await integrations.assertCanConnectMailbox(req.wctx);
      const url = await oauth.createAuthorizationUrl(db, { purpose: provider, userId: req.user!.id, workspaceId: req.wctx.workspaceId, redirectTo: input.redirect ?? '/app/integrations', loginHint: input.email ?? null });
      return { url };
    });

    scoped.post('/api/integrations/:id/test', async (req) => integrations.testIntegration(req.wctx, parse(idParam, req.params).id));

    scoped.patch('/api/integrations/:id', async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(z.object({ dailySendLimit: z.number().int().min(1).max(2000).optional(), isDefault: z.boolean().optional() }), req.body);
      await integrations.updateIntegrationSettings(req.wctx, id, input);
      return { ok: true };
    });

    scoped.delete('/api/integrations/:id', async (req) => {
      await integrations.disconnectIntegration(req.wctx, parse(idParam, req.params).id);
      return { ok: true };
    });

    scoped.post('/api/integrations/:id/sync', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
      const { id } = parse(idParam, req.params);
      await integrations.getIntegration(db, req.wctx.workspaceId, id);
      return inbox.syncIntegrationInbox(db, id);
    });

    // Billing
    scoped.get('/api/billing', async (req) => billing.billingOverview(req.wctx));
    scoped.post('/api/billing/checkout', async (req) => billing.createCheckoutSession(req.wctx, parse(z.object({ plan: z.string().max(40) }), req.body).plan));
    scoped.post('/api/billing/change-plan', async (req) => billing.changePlan(req.wctx, parse(z.object({ plan: z.string().max(40) }), req.body).plan));
    scoped.post('/api/billing/portal', async (req) => billing.createPortalSession(req.wctx));
    scoped.post('/api/billing/cancel', async (req) => {
      await billing.cancelSubscription(req.wctx, parse(z.object({ resume: z.boolean().default(false) }), req.body).resume);
      return { ok: true };
    });
    scoped.post('/api/billing/sync', async (req) => billing.syncCheckoutSession(req.wctx, parse(z.object({ sessionId: z.string().min(5).max(300) }), req.body).sessionId));

    // API keys
    scoped.get('/api/api-keys', async (req) => ({ keys: await apiKeys.listApiKeys(req.wctx) }));
    scoped.post('/api/api-keys', async (req) => apiKeys.createApiKey(req.wctx, parse(apiKeySchema, req.body)));
    scoped.delete('/api/api-keys/:id', async (req) => {
      await apiKeys.revokeApiKey(req.wctx, parse(idParam, req.params).id);
      return { ok: true };
    });

    // Workspace audit log (owners and admins)
    scoped.get('/api/audit-logs', async (req) => {
      const { assertCan } = await import('@localy/core');
      assertCan(req.wctx, 'audit.read', 'Only owners and admins can view the audit log.');
      const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1) }), req.query);
      return admin.adminAuditLogs(db, { page: q.page, workspaceId: req.wctx.workspaceId });
    });
  });
}
