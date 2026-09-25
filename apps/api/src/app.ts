import Fastify, { LogController, type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '@localy/config';
import { errorLogs, getDb } from '@localy/database';
import { AppError, ExternalServiceError, getLogger, isAppError } from '@localy/core';
import authPlugin from './plugins/auth';
import authRoutes from './routes/auth';
import oauthRoutes from './routes/oauth';
import meRoutes from './routes/me';
import discoveryRoutes from './routes/discovery';
import prospectRoutes from './routes/prospects';
import outreachRoutes from './routes/outreach';
import platformRoutes from './routes/platform';
import adminRoutes from './routes/admin';
import webhookRoutes from './routes/webhooks';
import publicApiRoutes from './routes/public-api';

export interface BuildOptions {
  /** Directory of the built web app to serve (single-origin deployments). */
  webDist?: string | null;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const cfg = getConfig();
  const app: FastifyInstance = Fastify({
    loggerInstance: (opts.logger === false ? undefined : getLogger()) as FastifyBaseLogger | undefined,
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 1_000_000,
    // Signed unsubscribe and verification tokens exceed Fastify's default of 100.
    routerOptions: { maxParamLength: 1000 },
    genReqId: () => crypto.randomUUID(),
    logController: new LogController({ disableRequestLogging: cfg.isTest }),
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.googleusercontent.com'],
        'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
        'connect-src': ["'self'", 'https://maps.googleapis.com', 'https://*.googleapis.com', 'https://*.gstatic.com'],
        'frame-src': ["'self'", 'https://*.google.com'],
        'worker-src': ["'self'", 'blob:'],
        'frame-ancestors': cfg.FRAME_ANCESTORS.split(/\s+/).filter(Boolean),
        'form-action': ["'self'"],
        'upgrade-insecure-requests': cfg.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    frameguard: false,
  });
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || cfg.corsOrigins.includes(origin.replace(/\/$/, ''))) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(cookie, { secret: cfg.SESSION_SECRET });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.cookies?.localy_session ? `s:${req.cookies.localy_session.slice(0, 16)}` : `ip:${req.ip}`),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: `Too many requests. Please wait ${Math.ceil(ctx.ttl / 1000)} seconds and try again.` },
    }),
  });

  app.setErrorHandler(async (err: FastifyError | AppError | Error, req, reply) => {
    if ((err as FastifyError).statusCode === 429 && (err as unknown as { error?: unknown }).error) {
      return reply.code(429).send(err);
    }
    if (isAppError(err)) {
      if (err.status >= 500) req.log.warn({ code: err.code, msg: err.message }, 'application error');
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id } });
    }
    if (err instanceof ExternalServiceError) {
      req.log.warn({ service: err.service, status: err.httpStatus, code: err.providerCode }, 'external service error');
      return reply.code(502).send({ error: { code: 'EXTERNAL_SERVICE_ERROR', message: 'A connected service is temporarily unavailable. Please try again shortly.', requestId: req.id } });
    }
    const fe = err as FastifyError;
    if (fe.validation || fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || fe.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500)) {
      return reply.code(fe.statusCode ?? 400).send({ error: { code: 'BAD_REQUEST', message: fe.statusCode === 413 ? 'The request is too large.' : 'The request could not be processed.', requestId: req.id } });
    }
    req.log.error({ err }, 'unhandled error');
    try {
      await getDb()
        .insert(errorLogs)
        .values({
          source: 'api',
          requestId: req.id,
          route: req.routeOptions?.url ?? req.url.split('?')[0],
          method: req.method,
          statusCode: 500,
          code: fe.code ?? null,
          message: err.message?.slice(0, 2000) ?? 'Unknown error',
          stack: err.stack?.slice(0, 8000) ?? null,
          workspaceId: req.wctx?.workspaceId ?? null,
          userId: req.user?.id ?? null,
        });
    } catch {
      /* ignore logging failures */
    }
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again. If it keeps happening, contact support.', requestId: req.id } });
  });

  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(oauthRoutes);
  await app.register(meRoutes);
  await app.register(discoveryRoutes);
  await app.register(prospectRoutes);
  await app.register(outreachRoutes);
  await app.register(platformRoutes);
  await app.register(adminRoutes);
  await app.register(webhookRoutes);
  await app.register(publicApiRoutes);

  const webDist = opts.webDist === undefined ? defaultWebDist() : opts.webDist;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          (res as unknown as { setHeader: (k: string, v: string) => void }).setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
      }
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } }));
  }
  return app;
}

function defaultWebDist(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.WEB_DIST, path.resolve(here, '../../web/dist'), path.resolve(here, '../web/dist')].filter(Boolean) as string[];
  return candidates.find((c) => fs.existsSync(path.join(c, 'index.html'))) ?? null;
}
