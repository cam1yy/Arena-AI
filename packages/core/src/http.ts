import { externalApiLogs, getDb } from '@localy/database';
import { ExternalServiceError } from './errors';
import { logger } from './logger';

export type ExternalService = 'places' | 'geocoding' | 'gmail' | 'graph' | 'stripe' | 'ai' | 'oauth' | 'website';

export interface ExternalRequest {
  service: ExternalService;
  operation: string;
  url: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  /** Form-encoded body (OAuth token endpoints). */
  form?: Record<string, string>;
  timeoutMs?: number;
  /** Retries for transient failures (network errors, 429, 5xx). */
  retries?: number;
  workspaceId?: string | null;
  /** Maps provider error payloads to a user-facing message and code. */
  parseError?: (status: number, payload: unknown) => { message?: string; code?: string } | undefined;
}

export interface ExternalResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function classify(status: number): ExternalServiceError['kind'] {
  if (status === 401) return 'auth';
  if (status === 429) return 'quota';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'transient';
  return 'permanent';
}

async function recordCall(req: ExternalRequest, ok: boolean, status: number | null, code: string | null, started: number) {
  try {
    await getDb()
      .insert(externalApiLogs)
      .values({
        service: req.service,
        operation: req.operation,
        ok,
        httpStatus: status,
        errorCode: code,
        durationMs: Math.round(performance.now() - started),
        workspaceId: req.workspaceId ?? null,
      });
  } catch (err) {
    logger.warn({ err }, 'failed to record external API call');
  }
}

/**
 * Server-side HTTP client for third-party APIs with timeouts, bounded
 * exponential-backoff retries for transient errors, structured request logging
 * (never logging secrets or payloads) and error classification.
 */
export async function externalFetch<T = unknown>(req: ExternalRequest): Promise<ExternalResponse<T>> {
  const retries = req.retries ?? 2;
  let attempt = 0;
  for (;;) {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 15_000);
    try {
      const headers: Record<string, string> = { Accept: 'application/json', ...req.headers };
      let body: string | undefined;
      if (req.form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(req.form).toString();
      } else if (req.body !== undefined) {
        headers['Content-Type'] ??= 'application/json';
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      }
      const res = await fetch(req.url, { method: req.method ?? 'GET', headers, body, signal: controller.signal });
      clearTimeout(timer);
      const text = await res.text();
      let payload: unknown = text;
      if (text && (res.headers.get('content-type') ?? '').includes('json')) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      } else if (!text) payload = null;

      if (res.ok) {
        await recordCall(req, true, res.status, null, started);
        return { status: res.status, data: payload as T, headers: res.headers };
      }
      const parsed = req.parseError?.(res.status, payload);
      const kind = classify(res.status);
      const code = parsed?.code ?? `HTTP_${res.status}`;
      await recordCall(req, false, res.status, code, started);
      const retryable = (kind === 'transient' || kind === 'quota') && attempt < retries;
      if (retryable) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 400 * 2 ** attempt + Math.random() * 200;
        attempt++;
        logger.warn({ service: req.service, operation: req.operation, status: res.status, attempt }, 'retrying external call');
        await sleep(delay);
        continue;
      }
      throw new ExternalServiceError(req.service, parsed?.message ?? `${req.service} request failed with status ${res.status}`, {
        httpStatus: res.status,
        providerCode: code,
        kind,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ExternalServiceError) throw err;
      const aborted = (err as Error).name === 'AbortError';
      await recordCall(req, false, null, aborted ? 'TIMEOUT' : 'NETWORK', started);
      if (attempt < retries) {
        attempt++;
        await sleep(400 * 2 ** attempt);
        continue;
      }
      throw new ExternalServiceError(req.service, aborted ? `${req.service} request timed out` : `Could not reach ${req.service}`, {
        kind: 'transient',
        providerCode: aborted ? 'TIMEOUT' : 'NETWORK',
        cause: err,
      });
    }
  }
}

/** Simple token-bucket limiter used to stay under provider QPS limits per process. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  private queue: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly perSecond: number, private readonly burst = Math.max(1, Math.ceil(perSecond))) {
    this.tokens = burst;
  }

  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
  }

  private drain = () => {
    this.timer = null;
    this.refill();
    while (this.tokens >= 1 && this.queue.length) {
      this.tokens -= 1;
      this.queue.shift()!();
    }
    if (this.queue.length) this.timer = setTimeout(this.drain, Math.ceil(1000 / this.perSecond));
  };

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      if (!this.timer) this.drain();
    });
  }
}

/** Runs async work over items with bounded concurrency, preserving order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
