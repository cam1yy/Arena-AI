import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { getConfig } from '@localy/config';
import { externalApiLogs, getDb } from '@localy/database';

/*
 * Transparent website verification.
 *
 * When a user asks Localy to check a listed website, Localy makes a single
 * HEAD request (falling back to a ranged GET) to the listed URL, identifies
 * itself with a descriptive User-Agent, follows at most three redirects, reads
 * no page content, and records only whether the site responded. Requests to
 * private, loopback and link-local networks are refused.
 */

export interface WebsiteCheckResult {
  status: 'detected' | 'unavailable';
  httpStatus: number | null;
  reason: string;
  finalHost: string | null;
  checkedAt: string;
}

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

/** DNS lookup that refuses to connect to non-public addresses (prevents SSRF and DNS rebinding). */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as (e: Error | null, a: string, f: number) => void)(err, '', 4);
    const list = (addresses as unknown as dns.LookupAddress[]) ?? [];
    const allowed = list.filter((a) => !isPrivateAddress(a.address));
    if (!allowed.length) {
      const e = Object.assign(new Error('Refusing to connect to a private network address'), { code: 'EPRIVATE' });
      return (callback as (e: Error | null, a: string, f: number) => void)(e, '', 4);
    }
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, allowed);
    (callback as (e: null, a: string, f: number) => void)(null, allowed[0].address, allowed[0].family);
  });
};

function requestOnce(url: URL, method: 'HEAD' | 'GET'): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method,
        lookup: safeLookup,
        timeout: 8000,
        headers: {
          'User-Agent': `LocalyWebsiteCheck/1.0 (+${getConfig().APP_URL.replace(/\/$/, '')}/website-check)`,
          Accept: 'text/html,*/*;q=0.8',
          ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}),
        },
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, location: typeof res.headers.location === 'string' ? res.headers.location : null });
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

function validateUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  // Any explicit scheme other than http(s) is refused (ftp:, file:, javascript:, ...).
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    // Public websites have a dotted hostname (or an IP literal, checked below).
    if (!u.hostname.includes('.') && !net.isIP(u.hostname.replace(/^\[|\]$/g, ''))) return null;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.port && u.port !== '80' && u.port !== '443') return null;
    if (u.username || u.password) return null;
    if (net.isIP(u.hostname) && isPrivateAddress(u.hostname)) return null;
    if (u.hostname === 'localhost' || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal')) return null;
    return u;
  } catch {
    return null;
  }
}

export async function checkWebsite(rawUrl: string, workspaceId?: string | null): Promise<WebsiteCheckResult> {
  const started = performance.now();
  const checkedAt = new Date().toISOString();
  let url = validateUrl(rawUrl);
  if (!url) return { status: 'unavailable', httpStatus: null, reason: 'The listed address is not a valid public website URL.', finalHost: null, checkedAt };
  let result: WebsiteCheckResult | undefined;
  try {
    for (let hop = 0; hop < 4; hop++) {
      let res = await requestOnce(url, 'HEAD');
      if (res.status === 405 || res.status === 501 || res.status === 403) res = await requestOnce(url, 'GET');
      if (res.status >= 300 && res.status < 400 && res.location) {
        const next = validateUrl(new URL(res.location, url).toString());
        if (!next) {
          result = { status: 'unavailable', httpStatus: res.status, reason: 'The website redirects to an address Localy will not follow.', finalHost: url.hostname, checkedAt };
          break;
        }
        url = next;
        continue;
      }
      if (res.status >= 200 && res.status < 400) {
        result = { status: 'detected', httpStatus: res.status, reason: 'The website responded successfully.', finalHost: url.hostname, checkedAt };
      } else if (res.status === 401 || res.status === 403 || res.status === 429) {
        // The server is up but declines automated checks. Treat as reachable.
        result = { status: 'detected', httpStatus: res.status, reason: 'The website is online but restricts automated checks.', finalHost: url.hostname, checkedAt };
      } else {
        result = { status: 'unavailable', httpStatus: res.status, reason: `The website returned an error (HTTP ${res.status}).`, finalHost: url.hostname, checkedAt };
      }
      break;
    }
    result ??= { status: 'unavailable', httpStatus: null, reason: 'The website redirected too many times.', finalHost: url.hostname, checkedAt };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const reason =
      code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        ? 'The website domain does not resolve.'
        : code === 'ETIMEDOUT'
          ? 'The website did not respond within 8 seconds.'
          : code === 'ECONNREFUSED'
            ? 'The website refused the connection.'
            : code === 'EPRIVATE'
              ? 'The website points to a private network address.'
              : code?.startsWith('ERR_TLS') || code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
                ? 'The website has an invalid security certificate.'
                : 'The website could not be reached.';
    result = { status: 'unavailable', httpStatus: null, reason, finalHost: url.hostname, checkedAt };
  }
  try {
    await getDb()
      .insert(externalApiLogs)
      .values({ service: 'website', operation: 'check', ok: result.status === 'detected', httpStatus: result.httpStatus, errorCode: null, durationMs: Math.round(performance.now() - started), workspaceId: workspaceId ?? null });
  } catch {
    /* logging is best-effort */
  }
  return result;
}

export const __test = { isPrivateAddress, validateUrl };
