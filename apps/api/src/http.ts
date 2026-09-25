import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import { AppError } from '@localy/core';

/** Parses and validates input with Zod, returning field-level errors in a consistent shape. */
export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      (fields[key] ??= []).push(issue.message);
    }
    const first = result.error.issues[0];
    throw new AppError('VALIDATION_ERROR', first?.message && first.message !== 'Required' ? first.message : 'Some fields need attention.', {
      details: { fields },
    });
  }
  return result.data;
}

export const idParam = z.object({ id: z.string().uuid('Invalid identifier') });

export function clientIp(req: FastifyRequest): string {
  return req.ip;
}

/** Outreach and mailbox connections require a verified account email (abuse prevention). */
export function requireVerifiedEmail(req: FastifyRequest) {
  if (req.wctx?.apiKeyId) return;
  if (!req.user?.emailVerifiedAt) {
    throw new AppError('EMAIL_NOT_VERIFIED', 'Confirm your email address first. Check your inbox for the verification link, or resend it from the banner at the top of the app.');
  }
}

export function noContent(reply: FastifyReply) {
  return reply.code(204).send();
}
