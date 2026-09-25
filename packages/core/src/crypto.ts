import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { getConfig } from '@localy/config';

/** URL-safe random token with the given number of random bytes. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmac(value: string, secret = getConfig().SESSION_SECRET): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** A precomputed hash used to keep sign-in timing constant for unknown emails. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordCheck(password: string): Promise<boolean> {
  dummyHash ??= hashPassword(randomToken(16));
  return dummyHash.then((h) => verifyPassword(h, password)).then(() => false);
}

/*
 * Authenticated encryption for stored credentials (OAuth tokens, TOTP
 * secrets). AES-256-GCM with a random 96-bit IV. Format: v1.<iv>.<tag>.<data>
 */
function key(): Buffer {
  return Buffer.from(getConfig().EMAIL_ENCRYPTION_KEY, 'base64');
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unsupported encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export const encryptOptional = (v: string | null | undefined) => (v ? encryptSecret(v) : null);
export const decryptOptional = (v: string | null | undefined) => (v ? decryptSecret(v) : null);

/** PKCE helpers for OAuth 2.0 authorization code flows. */
export function pkcePair() {
  const verifier = randomToken(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Signed, expiring token for public links (for example unsubscribe). */
export function signPayload(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body)}`;
}

export function verifySignedPayload<T extends Record<string, unknown>>(token: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!safeEqual(hmac(body), sig)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

/*
 * Compact signed unsubscribe tokens: base64url(workspace UUID bytes +
 * prospect UUID bytes + recipient email) + "." + truncated HMAC. Short enough
 * to read comfortably in a plain-text email footer.
 */
const uuidToBytes = (u: string | null) => (u ? Buffer.from(u.replace(/-/g, ''), 'hex') : Buffer.alloc(16));
const bytesToUuid = (b: Buffer) => {
  const h = b.toString('hex');
  return /^0+$/.test(h) ? null : `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export function signUnsubscribeToken(workspaceId: string, email: string, prospectId: string | null): string {
  const body = Buffer.concat([uuidToBytes(workspaceId), uuidToBytes(prospectId), Buffer.from(email.toLowerCase(), 'utf8')]).toString('base64url');
  return `${body}.${hmac(`u:${body}`).slice(0, 22)}`;
}

export function verifyUnsubscribeToken(token: string): { workspaceId: string; email: string; prospectId: string | null } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEqual(hmac(`u:${body}`).slice(0, 22), sig)) return null;
  const buf = Buffer.from(body, 'base64url');
  if (buf.length <= 32) return null;
  const workspaceId = bytesToUuid(buf.subarray(0, 16));
  if (!workspaceId) return null;
  return { workspaceId, prospectId: bytesToUuid(buf.subarray(16, 32)), email: buf.subarray(32).toString('utf8') };
}
