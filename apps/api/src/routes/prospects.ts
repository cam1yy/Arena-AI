import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  bulkProspectSchema,
  createProspectSchema,
  followUpSchema,
  noteSchema,
  prospectListQuerySchema,
  saveProspectsSchema,
  tagSchema,
  updateProspectSchema,
} from '@localy/shared';
import { analytics, prospects } from '@localy/core';
import { idParam, parse } from '../http';

export default async function prospectRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireWorkspace);

  app.get('/api/prospects', async (req) => {
    const q = parse(prospectListQuerySchema, req.query);
    if (!q.ids) q.pageSize = Math.min(q.pageSize, 100);
    return prospects.listProspects(req.wctx, q);
  });

  app.get('/api/prospects/ids', async (req) => {
    const q = parse(prospectListQuerySchema.omit({ page: true, pageSize: true }), req.query);
    return { ids: await prospects.listProspectIds(req.wctx, q) };
  });

  app.get('/api/prospects/counts', async (req) => ({ counts: await prospects.prospectCounts(req.wctx) }));

  app.post('/api/prospects', async (req, reply) => {
    const input = parse(createProspectSchema, req.body);
    const p = await prospects.createManualProspect(req.wctx, input as Parameters<typeof prospects.createManualProspect>[1]);
    return reply.code(201).send({ id: p.id });
  });

  app.post('/api/prospects/from-discovery', async (req, reply) => {
    const input = parse(saveProspectsSchema, req.body);
    const res = await prospects.saveFromDiscovery(req.wctx, input);
    return reply.code(201).send(res);
  });

  app.post('/api/prospects/bulk', async (req) => {
    const input = parse(bulkProspectSchema, req.body);
    return prospects.bulkAction(req.wctx, input);
  });

  app.get('/api/prospects/export', async (req, reply) => {
    // `ids` (comma-separated) narrows the export to selected prospects.
    const q = parse(prospectListQuerySchema.omit({ page: true, pageSize: true }).extend({ format: z.enum(['csv', 'json']).default('csv') }), req.query);
    const rows = await prospects.exportProspects(req.wctx, q);
    const stamp = new Date().toISOString().slice(0, 10);
    if (q.format === 'json') {
      reply.header('Content-Disposition', `attachment; filename="localy-prospects-${stamp}.json"`);
      return {
        exportedAt: new Date().toISOString(),
        notice: 'Contains your own data and Google place IDs only. Business details from Google Maps are not stored by Localy and are not included.',
        prospects: rows,
      };
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="localy-prospects-${stamp}.csv"`);
    return prospects.toCsv(rows as unknown as Record<string, string>[], prospects.EXPORT_COLUMNS);
  });

  app.get('/api/prospects/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    return prospects.getProspectDetail(req.wctx, id);
  });

  app.patch('/api/prospects/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(updateProspectSchema, req.body);
    const p = await prospects.updateProspect(req.wctx, id, input);
    return { id: p.id, status: p.status };
  });

  app.delete('/api/prospects/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await prospects.deleteProspect(req.wctx, id);
    return { ok: true };
  });

  // Notes
  app.post('/api/prospects/:id/notes', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { body } = parse(noteSchema, req.body);
    const n = await prospects.addNote(req.wctx, id, body);
    return reply.code(201).send({ id: n.id });
  });

  app.patch('/api/notes/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const { body } = parse(noteSchema, req.body);
    await prospects.updateNote(req.wctx, id, body);
    return { ok: true };
  });

  app.delete('/api/notes/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await prospects.deleteNote(req.wctx, id);
    return { ok: true };
  });

  // Tags
  app.get('/api/tags', async (req) => ({ tags: await prospects.listTags(req.wctx) }));

  app.post('/api/tags', async (req) => {
    const { name } = parse(tagSchema, req.body);
    return { tag: await prospects.upsertTag(req.wctx, name) };
  });

  app.patch('/api/tags/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const { name } = parse(tagSchema, req.body);
    return { tag: await prospects.renameTag(req.wctx, id, name) };
  });

  app.delete('/api/tags/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await prospects.deleteTag(req.wctx, id);
    return { ok: true };
  });

  app.post('/api/prospects/:id/tags', async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(z.object({ tagId: z.string().uuid().optional(), name: z.string().trim().max(40).optional() }), req.body);
    return { tag: await prospects.addTagToProspect(req.wctx, id, input) };
  });

  app.delete('/api/prospects/:id/tags/:tagId', async (req) => {
    const { id, tagId } = parse(z.object({ id: z.string().uuid(), tagId: z.string().uuid() }), req.params);
    await prospects.removeTagFromProspect(req.wctx, id, tagId);
    return { ok: true };
  });

  // Follow-ups
  app.get('/api/follow-ups', async (req) => {
    const q = parse(z.object({ window: z.enum(['overdue', 'today', 'upcoming', 'all']).default('all') }), req.query);
    return { items: await analytics.listFollowUps(req.wctx, q) };
  });

  app.post('/api/follow-ups', async (req, reply) => {
    const input = parse(followUpSchema, req.body);
    const f = await prospects.scheduleFollowUp(req.wctx, input);
    return reply.code(201).send({ id: f.id });
  });

  app.patch('/api/follow-ups/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(z.object({ status: z.enum(['done', 'cancelled', 'scheduled']).optional(), dueAt: z.string().datetime({ offset: true }).optional(), note: z.string().max(1000).nullable().optional() }), req.body);
    await prospects.updateFollowUp(req.wctx, id, input);
    return { ok: true };
  });
}
