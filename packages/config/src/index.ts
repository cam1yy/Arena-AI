import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Centralized, validated runtime configuration shared by the API, the worker,
 * the database tooling and the tests. Values are read from process.env once.
 * Secrets are never exposed to the browser; see `publicConfig` in the API for
 * the small subset that is safe to send to clients.
 */

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const DEV_SESSION_SECRET = 'dev-only-session-secret-change-me-0123456789abcdef';
// 32 zero-ish bytes, base64. Development only; production refuses to start with it.
const DEV_ENCRYPTION_KEY = 'ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE=';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:4000'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: optionalString,
  TRUST_PROXY: bool(true),
  COOKIE_DOMAIN: optionalString,
  // `none` (with COOKIE_PARTITIONED) is only needed when the app is embedded in
  // a cross-site iframe. CSRF protection does not depend on SameSite.
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_PARTITIONED: bool(false),
  // Space-separated CSP frame-ancestors sources. Defaults to same-origin only.
  FRAME_ANCESTORS: z.string().default("'self'"),

  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:5432/localy'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  SESSION_SECRET: z.string().min(32).default(DEV_SESSION_SECRET),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  EMAIL_ENCRYPTION_KEY: z.string().min(1).default(DEV_ENCRYPTION_KEY),

  // Google Maps Platform. The server key is used for Places API (New) and
  // Geocoding and must never reach the browser. The browser key is a separate,
  // HTTP-referrer-restricted key for the Maps JavaScript API only.
  GOOGLE_MAPS_API_KEY: optionalString,
  GOOGLE_MAPS_BROWSER_KEY: optionalString,
  GOOGLE_MAPS_MAP_ID: optionalString,
  GOOGLE_PLACES_BASE_URL: z.string().url().default('https://places.googleapis.com'),
  GOOGLE_GEOCODING_BASE_URL: z.string().url().default('https://maps.googleapis.com'),
  GOOGLE_PLACES_LANGUAGE: z.string().default('en'),
  GOOGLE_PLACES_REGION: optionalString,
  PLACES_REQUESTS_PER_SECOND: z.coerce.number().positive().default(10),

  // OAuth: Google (sign-in and Gmail) and Microsoft (Outlook / Microsoft 365).
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_OAUTH_BASE_URL: z.string().url().default('https://accounts.google.com'),
  GOOGLE_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
  GMAIL_API_BASE_URL: z.string().url().default('https://gmail.googleapis.com'),
  MICROSOFT_CLIENT_ID: optionalString,
  MICROSOFT_CLIENT_SECRET: optionalString,
  MICROSOFT_TENANT: z.string().default('common'),
  MICROSOFT_LOGIN_BASE_URL: z.string().url().default('https://login.microsoftonline.com'),
  MICROSOFT_GRAPH_BASE_URL: z.string().url().default('https://graph.microsoft.com'),

  // Stripe billing.
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_PRICE_ID_PRO: optionalString,
  STRIPE_PRICE_ID_AGENCY: optionalString,
  STRIPE_API_BASE_URL: optionalString,

  // System email (verification, password reset, invitations, notifications).
  SMTP_URL: optionalString,
  MAIL_FROM: z.string().default('Localy <no-reply@localy.local>'),
  SUPPORT_EMAIL: z.string().default('support@localy.local'),

  // Optional AI assistance. Output is always placed in an editor for review.
  AI_PROVIDER: z
    .enum(['openai', 'anthropic', 'none'])
    .optional()
    .transform((v) => v ?? 'none'),
  AI_MODEL: optionalString,
  OPENAI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com'),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),

  // Development tooling. The sandbox mailbox captures outreach locally and
  // never delivers anything. It cannot be enabled in production.
  ENABLE_DEV_EMAIL_SANDBOX: optionalString,
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  TRIAL_DAYS: z.coerce.number().int().positive().default(14),
});

export type AppConfig = z.infer<typeof schema> & {
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  cookieSecure: boolean;
  corsOrigins: string[];
  devSandboxEnabled: boolean;
  features: {
    places: boolean;
    maps: boolean;
    googleSignIn: boolean;
    gmail: boolean;
    microsoft: boolean;
    stripe: boolean;
    stripeWebhooks: boolean;
    smtp: boolean;
    ai: boolean;
  };
};

function build(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === 'production';
  if (isProduction) {
    const problems: string[] = [];
    if (c.SESSION_SECRET === DEV_SESSION_SECRET) problems.push('SESSION_SECRET must be set to a unique random value');
    if (c.EMAIL_ENCRYPTION_KEY === DEV_ENCRYPTION_KEY)
      problems.push('EMAIL_ENCRYPTION_KEY must be set to a unique 32-byte base64 value');
    if (problems.length) throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
  const keyBytes = Buffer.from(c.EMAIL_ENCRYPTION_KEY, 'base64');
  if (keyBytes.length !== 32) {
    throw new Error('EMAIL_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes. Generate one with: openssl rand -base64 32');
  }
  const aiKey = c.AI_PROVIDER === 'openai' ? c.OPENAI_API_KEY : c.AI_PROVIDER === 'anthropic' ? c.ANTHROPIC_API_KEY : undefined;
  const devSandboxEnabled =
    !isProduction && (c.ENABLE_DEV_EMAIL_SANDBOX === undefined ? true : ['1', 'true', 'yes'].includes(c.ENABLE_DEV_EMAIL_SANDBOX));
  return {
    ...c,
    isProduction,
    isDevelopment: c.NODE_ENV === 'development',
    isTest: c.NODE_ENV === 'test',
    cookieSecure: c.APP_URL.startsWith('https://'),
    corsOrigins: (c.CORS_ORIGINS ?? c.APP_URL)
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
    devSandboxEnabled,
    features: {
      places: Boolean(c.GOOGLE_MAPS_API_KEY),
      maps: Boolean(c.GOOGLE_MAPS_BROWSER_KEY),
      googleSignIn: Boolean(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET),
      gmail: Boolean(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET),
      microsoft: Boolean(c.MICROSOFT_CLIENT_ID && c.MICROSOFT_CLIENT_SECRET),
      stripe: Boolean(c.STRIPE_SECRET_KEY),
      stripeWebhooks: Boolean(c.STRIPE_SECRET_KEY && c.STRIPE_WEBHOOK_SECRET),
      smtp: Boolean(c.SMTP_URL),
      ai: c.AI_PROVIDER !== 'none' && Boolean(aiKey),
    },
  };
}

let cached: AppConfig | undefined;
let dotenvLoaded = false;

/**
 * Loads the nearest .env file (walking up from the working directory) into
 * process.env. Variables already set in the environment take precedence.
 */
function loadDotEnv() {
  if (dotenvLoaded || process.env.LOCALY_SKIP_DOTENV === '1') return;
  dotenvLoaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const file = path.join(dir, '.env');
    if (fs.existsSync(file)) {
      try {
        process.loadEnvFile(file);
      } catch (err) {
        console.warn(`[config] could not read ${file}: ${(err as Error).message}`);
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function getConfig(): AppConfig {
  if (!cached) {
    loadDotEnv();
    cached = build(process.env);
  }
  return cached;
}

/** Test helper: rebuild configuration after mutating process.env. */
export function resetConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  cached = build(process.env);
  return cached;
}

export const config = new Proxy({} as AppConfig, {
  get(_target, prop: string) {
    return getConfig()[prop as keyof AppConfig];
  },
});
