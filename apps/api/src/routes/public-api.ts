import type { FastifyInstance } from 'fastify';
import { prospectListQuerySchema } from '@localy/shared';
import { campaigns, prospects, templates } from '@localy/core';
import { idParam, parse } from '../http';

/**
 * Public REST API (v1), authenticated with workspace API keys:
 *   Authorization: Bearer lcl_...
 * Read-only keys may only call GET endpoints. Google Maps content is not
 * returned by the public API; prospects include place IDs only.
 */
export default async function publicApiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.headers.authorization?.startsWith('Bearer lcl_')) {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Provide an API key: Authorization: Bearer lcl_...' } });
    }
    await app.requireWorkspace(req, reply);
  });

  app.get('/api/v1/prospects', async (req) => {
    const q = parse(prospectListQuerySchema, req.query);
    const res = await prospects.listProspects(req.wctx, q, { live: false });
    return { ...res, items: res.items.map(({ live: _live, liveError: _le, ...rest }) => rest) };
  });

  app.get('/api/v1/prospects/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const p = await prospects.getProspectOrThrow(req.wctx.db, req.wctx.workspaceId, id);
    return {
      id: p.id,
      placeId: p.placeId,
      status: p.status,
      name: p.name,
      contactFirstName: p.contactFirstName,
      contactLastName: p.contactLastName,
      email: p.email,
      phone: p.phone,
      locationLabel: p.locationLabel,
      categoryLabel: p.categoryLabel,
      websiteStatus: p.websiteStatus,
      signals: p.signals,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  });

  app.get('/api/v1/campaigns', async (req) => ({ campaigns: await campaigns.listCampaigns(req.wctx) }));
  app.get('/api/v1/templates', async (req) => ({ templates: await templates.listTemplates(req.wctx) }));
}
