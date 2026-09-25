import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@localy/database';

export interface TestClient {
  cookie: string | null;
  /** Each simulated client has its own IP, like separate real users. */
  ip: string;
  request: (method: string, url: string, body?: unknown, headers?: Record<string, string>) => Promise<LightMyRequestResponse>;
  json: <T = Record<string, unknown>>(method: string, url: string, body?: unknown) => Promise<{ status: number; body: T }>;
}

let appPromise: Promise<FastifyInstance> | undefined;

export async function getApp(): Promise<FastifyInstance> {
  appPromise ??= (async () => {
    const { buildApp } = await import('../../apps/api/src/app');
    const app = await buildApp({ webDist: null, logger: false });
    await app.ready();
    return app;
  })();
  return appPromise;
}

let ipCounter = 0;
export function client(app: FastifyInstance): TestClient {
  ipCounter++;
  const c: TestClient = {
    cookie: null,
    ip: `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`,
    request: async (method, url, body, headers = {}) => {
      const res = await app.inject({
        method: method as 'GET',
        url,
        remoteAddress: c.ip,
        payload: body === undefined ? undefined : (body as object),
        headers: {
          'x-localy-csrf': '1',
          ...(c.cookie ? { cookie: c.cookie } : {}),
          ...headers,
        },
      });
      const set = res.headers['set-cookie'];
      const list = Array.isArray(set) ? set : set ? [set] : [];
      for (const s of list) {
        const [pair] = s.split(';');
        if (pair.startsWith('localy_session=')) c.cookie = pair.endsWith('=') ? null : pair;
      }
      return res;
    },
    json: async (method, url, body) => {
      const res = await c.request(method, url, body);
      return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
    },
  };
  return c;
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter++;
  return `${prefix}.${Date.now()}.${counter}@example.test`;
}

export const PASSWORD = 'correct-horse-42-battery';

/** Signs up a new user (with their own workspace) and marks the email verified. */
export async function signUp(app: FastifyInstance, opts: { name?: string; workspaceName?: string; verified?: boolean } = {}) {
  const c = client(app);
  const email = uniqueEmail();
  const res = await c.json<{ user: { id: string } }>('POST', '/api/auth/signup', { name: opts.name ?? 'Test User', email, password: PASSWORD, workspaceName: opts.workspaceName ?? 'Test Workspace' });
  if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.body)}`);
  if (opts.verified !== false) await getDb().update(users).set({ emailVerifiedAt: new Date(), onboardingCompletedAt: new Date() }).where(eq(users.email, email));
  const me = await c.json<{ workspace: { id: string } }>('GET', '/api/me');
  return { client: c, email, userId: res.body.user.id, workspaceId: me.body.workspace.id };
}
