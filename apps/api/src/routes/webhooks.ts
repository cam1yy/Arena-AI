import type { FastifyInstance } from 'fastify';
import { getDb } from '@localy/database';
import { billing } from '@localy/core';

export default async function webhookRoutes(app: FastifyInstance) {
  // Stripe requires the raw request body for signature verification.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.post('/api/webhooks/stripe', { config: { rateLimit: false } }, async (req) => {
    const sig = req.headers['stripe-signature'];
    const res = await billing.handleStripeWebhook(getDb(), req.body as Buffer, Array.isArray(sig) ? sig[0] : sig);
    return { received: true, ...res };
  });
}
