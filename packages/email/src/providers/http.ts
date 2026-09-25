import { ProviderError } from '../types';

export interface ProviderFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  onCall?: (info: { ok: boolean; status: number | null; durationMs: number; code: string | null }) => void;
}

/** Minimal fetch wrapper that maps provider HTTP failures to ProviderError kinds. */
export async function providerFetch<T>(url: string, opts: ProviderFetchOptions = {}): Promise<T> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? 'GET', headers: opts.headers, body: opts.body, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    opts.onCall?.({ ok: false, status: null, durationMs: performance.now() - started, code: 'NETWORK' });
    throw new ProviderError((err as Error).name === 'AbortError' ? 'The email provider did not respond in time.' : 'Could not reach the email provider.', 'transient');
  }
  clearTimeout(timer);
  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  opts.onCall?.({ ok: res.ok, status: res.status, durationMs: performance.now() - started, code: res.ok ? null : `HTTP_${res.status}` });
  if (res.ok) return payload as T;
  const errObj = (payload as { error?: { message?: string; code?: string | number; status?: string } | string; error_description?: string }) ?? {};
  const message =
    (typeof errObj.error === 'object' ? errObj.error?.message : undefined) ??
    errObj.error_description ??
    (typeof errObj.error === 'string' ? errObj.error : undefined) ??
    `Provider request failed (${res.status})`;
  if (res.status === 401 || (res.status === 400 && /invalid_grant/i.test(text))) throw new ProviderError(message, 'auth', res.status);
  if (res.status === 403 && /insufficient|scope|permission/i.test(text)) throw new ProviderError(message, 'auth', res.status);
  if (res.status === 429 || (res.status === 403 && /rate|quota|limit/i.test(text))) throw new ProviderError(message, 'rate_limit', res.status);
  if (res.status >= 500) throw new ProviderError(message, 'transient', res.status);
  if (res.status === 400 && /recipient|address|invalid to/i.test(text)) throw new ProviderError(message, 'invalid_recipient', res.status);
  throw new ProviderError(message, 'permanent', res.status);
}
