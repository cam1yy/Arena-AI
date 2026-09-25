import type { ApiErrorBody } from '@localy/shared';

/** Error thrown for any non-2xx API response, carrying the server's safe message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get fields(): Record<string, string[]> {
    return ((this.details as { fields?: Record<string, string[]> } | undefined)?.fields ?? {}) as Record<string, string[]>;
  }
}

type Listener = (err: ApiError) => void;
const authListeners = new Set<Listener>();
export function onAuthError(fn: Listener) {
  authListeners.add(fn);
  return () => {
    authListeners.delete(fn);
  };
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        // Required on every state-changing request (CSRF protection).
        'X-Localy-CSRF': '1',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'We could not reach Localy. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    const err = new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? 'Something went wrong. Please try again.', e?.details, e?.requestId);
    if (res.status === 401 && err.code !== 'TWO_FACTOR_REQUIRED') authListeners.forEach((l) => l(err));
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>('GET', path, undefined, init),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

/** Triggers a browser download for an authenticated GET endpoint. */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) {
    let message = 'The export could not be created.';
    try {
      message = ((await res.json()) as ApiErrorBody).error.message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, 'EXPORT_FAILED', message);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
