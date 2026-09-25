import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '@localy/database';
import { campaignSchema, composeSchema, templateSchema, testEmailSchema, replySchema, aiRequestSchema, renderEmail } from '@localy/shared';
import { AppError, ai, campaigns, inbox, integrations, personalization, prospects, sending, templates } from '@localy/core';
import { getConfig } from '@localy/config';
import { idParam, parse, requireVerifiedEmail } from '../http';

export default async function outreachRoutes(app: FastifyInstance) {
  const db = getDb();
  app.addHook('preHandler', app.requireWorkspace);

  // Templates
  app.get('/api/templates', async (req) => ({ templates: await templates.listTemplates(req.wctx) }));
  app.get('/api/templates/:id', async (req) => ({ template: await templates.getTemplate(req.wctx, parse(idParam, req.params).id) }));
  app.post('/api/templates', async (req, reply) => reply.code(201).send({ template: await templates.createTemplate(req.wctx, parse(templateSchema, req.body)) }));
  app.put('/api/templates/:id', async (req) => ({ template: await templates.updateTemplate(req.wctx, parse(idParam, req.params).id, parse(templateSchema, req.body)) }));
  app.post('/api/templates/:id/duplicate', async (req) => ({ template: await templates.duplicateTemplate(req.wctx, parse(idParam, req.params).id) }));
  app.delete('/api/templates/:id', async (req) => {
    await templates.deleteTemplate(req.wctx, parse(idParam, req.params).id);
    return { ok: true };
  });

  /** Renders a template for a specific prospect exactly as it would be sent. */
  app.post('/api/preview', async (req) => {
    const input = parse(z.object({ prospectId: z.string().uuid().optional().nullable(), subject: z.string().max(300), body: z.string().max(20000), senderName: z.string().max(100).optional().nullable() }), req.body);
    const sender = await personalization.senderContext(db, req.wctx.workspaceId, { userId: req.wctx.userId, senderName: input.senderName });
    if (!input.prospectId) {
      // Without a recipient, business-specific variables stay visible as placeholders.
      const r = renderEmail(input.subject, input.body, { senderName: sender.senderName, agencyName: sender.agencyName }, { keepMissing: true });
      return { subject: r.subject, body: r.body, missing: [], footer: sender.includeUnsubscribeFooter, signature: sender.signature, recipient: null };
    }
    const p = await prospects.getProspectOrThrow(db, req.wctx.workspaceId, input.prospectId);
    let vars;
    let liveError: string | null = null;
    try {
      vars = (await personalization.variablesForProspect(p, sender)).vars;
    } catch (err) {
      liveError = err instanceof AppError ? err.message : 'Business details are temporarily unavailable.';
      vars = (await personalization.variablesForProspect(p, sender, { fetchLive: false })).vars;
    }
    const composed = personalization.composeEmail(input.subject, input.body, vars, sender, { workspaceId: req.wctx.workspaceId, toEmail: p.email ?? 'recipient@example.com', prospectId: p.id });
    return {
      subject: composed.subject,
      body: composed.text,
      missing: composed.missing,
      recipient: { id: p.id, email: p.email, name: vars.businessName ?? null, firstName: p.contactFirstName },
      variables: vars,
      liveError,
    };
  });

  // Campaigns
  app.get('/api/campaigns', async (req) => {
    const q = parse(z.object({ status: z.string().max(20).optional() }), req.query);
    return { campaigns: await campaigns.listCampaigns(req.wctx, q) };
  });
  app.get('/api/campaigns/options', async (req) => ({ campaigns: await campaigns.campaignOptions(req.wctx) }));
  app.post('/api/campaigns', async (req, reply) => reply.code(201).send({ campaign: await campaigns.createCampaign(req.wctx, parse(campaignSchema, req.body)) }));
  app.get('/api/campaigns/:id', async (req) => ({ campaign: await campaigns.getCampaign(req.wctx, parse(idParam, req.params).id) }));
  app.put('/api/campaigns/:id', async (req) => ({ campaign: await campaigns.updateCampaign(req.wctx, parse(idParam, req.params).id, parse(campaignSchema, req.body)) }));
  app.delete('/api/campaigns/:id', async (req) => {
    await campaigns.deleteCampaign(req.wctx, parse(idParam, req.params).id);
    return { ok: true };
  });
  app.post('/api/campaigns/:id/duplicate', async (req) => ({ campaign: await campaigns.duplicateCampaign(req.wctx, parse(idParam, req.params).id) }));
  app.get('/api/campaigns/:id/readiness', async (req) => campaigns.readiness(req.wctx, parse(idParam, req.params).id));
  app.post('/api/campaigns/:id/status', async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(z.object({ action: z.enum(['start', 'pause', 'resume', 'complete']), confirm: z.boolean().default(false) }), req.body);
    if (input.action === 'start' || input.action === 'resume') requireVerifiedEmail(req);
    let campaign;
    if (input.action === 'start' || input.action === 'resume') campaign = await campaigns.startCampaign(req.wctx, id, { confirm: input.confirm });
    else if (input.action === 'pause') campaign = await campaigns.pauseCampaign(req.wctx, id);
    else campaign = await campaigns.completeCampaign(req.wctx, id);
    return { campaign };
  });
  app.get('/api/campaigns/:id/recipients', async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50), status: z.string().max(20).optional() }), req.query);
    return campaigns.listRecipients(req.wctx, id, q);
  });
  app.post('/api/campaigns/:id/recipients', async (req) => {
    const { id } = parse(idParam, req.params);
    const { prospectIds } = parse(z.object({ prospectIds: z.array(z.string().uuid()).min(1).max(5000) }), req.body);
    return campaigns.addRecipients(req.wctx, id, prospectIds);
  });
  app.delete('/api/campaigns/:id/recipients/:recipientId', async (req) => {
    const { id, recipientId } = parse(z.object({ id: z.string().uuid(), recipientId: z.string().uuid() }), req.params);
    await campaigns.removeRecipient(req.wctx, id, recipientId);
    return { ok: true };
  });
  app.post('/api/prospects/:id/stop-sequence', async (req) => {
    const { id } = parse(idParam, req.params);
    const { campaignId } = parse(z.object({ campaignId: z.string().uuid().optional() }), req.body);
    return { stopped: await campaigns.stopRecipientSequence(req.wctx, id, campaignId) };
  });

  // Composer
  app.post('/api/compose/send', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    requireVerifiedEmail(req);
    const input = parse(composeSchema, req.body);
    return campaigns.composeAndSend(req.wctx, input);
  });

  app.post('/api/compose/test', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    requireVerifiedEmail(req);
    const input = parse(testEmailSchema, req.body);
    const to = input.to ?? req.user?.email;
    if (!to) throw new AppError('BAD_REQUEST', 'Enter an address for the test email.');
    await integrations.getIntegration(db, req.wctx.workspaceId, input.integrationId);
    const res = await sending.sendTestEmail(db, { workspaceId: req.wctx.workspaceId, userId: req.wctx.userId!, integrationId: input.integrationId, to, subject: input.subject, body: input.body, prospectId: input.prospectId });
    if (res.status !== 'sent') throw new AppError('INTEGRATION_ERROR', 'The test email could not be sent. Check the mailbox connection.');
    return { ok: true, to };
  });

  // Inbox
  app.get('/api/inbox', async (req) => {
    const q = parse(z.object({ status: z.enum(['open', 'archived', 'all']).default('open'), filter: z.enum(['all', 'replied', 'unread']).default('all'), q: z.string().max(200).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
    return inbox.listThreads(req.wctx, q);
  });
  app.get('/api/inbox/:id', async (req) => inbox.getThread(req.wctx, parse(idParam, req.params).id));
  app.post('/api/inbox/:id/reply', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    requireVerifiedEmail(req);
    const { id } = parse(idParam, req.params);
    const { body } = parse(replySchema, req.body);
    return inbox.replyToThread(req.wctx, id, body);
  });
  app.post('/api/inbox/:id/status', async (req) => {
    const { id } = parse(idParam, req.params);
    const { status } = parse(z.object({ status: z.enum(['open', 'archived']) }), req.body);
    await inbox.setThreadStatus(req.wctx, id, status);
    return { ok: true };
  });
  app.post('/api/inbox/:id/unread', async (req) => {
    await inbox.markThreadUnread(req.wctx, parse(idParam, req.params).id);
    return { ok: true };
  });
  app.post('/api/inbox/:id/simulate-reply', async (req) => {
    if (!getConfig().devSandboxEnabled) throw new AppError('NOT_FOUND', 'Not found.');
    const { id } = parse(idParam, req.params);
    const input = parse(z.object({ body: z.string().trim().min(1).max(5000), bounce: z.boolean().default(false) }), req.body);
    return { result: await inbox.simulateReply(req.wctx, id, input.body, input.bounce) };
  });

  // AI assistance (always returned for review, never sent automatically)
  app.post('/api/ai', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => ai.runAiTask(req.wctx, parse(aiRequestSchema, req.body)));
}
