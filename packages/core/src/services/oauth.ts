import { and, eq, gt, lt } from 'drizzle-orm';
import { getConfig } from '@localy/config';
import { oauthStates, type Database } from '@localy/database';
import { GMAIL_SCOPES, MICROSOFT_SCOPES } from '@localy/email';
import { AppError, notConfigured } from '../errors';
import { pkcePair, randomToken, sha256 } from '../crypto';
import { externalFetch } from '../http';

/*
 * OAuth 2.0 authorization code flow with PKCE for Google (sign-in, Gmail) and
 * Microsoft (Outlook / Microsoft 365). State values are single-use, hashed at
 * rest, bound to the initiating user and workspace, and expire after 10 minutes.
 */

export type OAuthPurpose = 'login' | 'gmail' | 'microsoft';
const LOGIN_SCOPES = ['openid', 'email', 'profile'];

export function redirectUri(provider: 'google' | 'microsoft'): string {
  return `${getConfig().API_URL.replace(/\/$/, '')}/api/oauth/${provider}/callback`;
}

export async function createAuthorizationUrl(
  db: Database,
  opts: { purpose: OAuthPurpose; userId?: string | null; workspaceId?: string | null; redirectTo?: string | null; loginHint?: string | null },
): Promise<string> {
  const cfg = getConfig();
  const state = randomToken(24);
  const { verifier, challenge } = pkcePair();
  await db.insert(oauthStates).values({
    stateHash: sha256(state),
    purpose: opts.purpose,
    userId: opts.userId ?? null,
    workspaceId: opts.workspaceId ?? null,
    codeVerifier: verifier,
    redirectTo: sanitizeRedirect(opts.redirectTo),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  if (opts.purpose === 'microsoft') {
    if (!cfg.features.microsoft) throw notConfigured('Microsoft Outlook', ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET']);
    const url = new URL(`${cfg.MICROSOFT_LOGIN_BASE_URL.replace(/\/$/, '')}/${cfg.MICROSOFT_TENANT}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({
      client_id: cfg.MICROSOFT_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: redirectUri('microsoft'),
      response_mode: 'query',
      scope: MICROSOFT_SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
      ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
    }).toString();
    return url.toString();
  }
  if (!cfg.features.googleSignIn) {
    throw notConfigured(opts.purpose === 'gmail' ? 'Gmail' : 'Google sign-in', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
  }
  const url = new URL('/o/oauth2/v2/auth', cfg.GOOGLE_OAUTH_BASE_URL);
  const params: Record<string, string> = {
    client_id: cfg.GOOGLE_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: redirectUri('google'),
    scope: (opts.purpose === 'gmail' ? GMAIL_SCOPES : LOGIN_SCOPES).join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    include_granted_scopes: 'true',
  };
  if (opts.purpose === 'gmail') {
    params.access_type = 'offline';
    params.prompt = 'consent';
  } else {
    params.prompt = 'select_account';
  }
  if (opts.loginHint) params.login_hint = opts.loginHint;
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

function sanitizeRedirect(path: string | null | undefined): string | null {
  if (!path) return null;
  // Only allow same-app relative paths.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  return path.slice(0, 300);
}

export async function consumeState(db: Database, state: string) {
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  const [row] = await db
    .delete(oauthStates)
    .where(and(eq(oauthStates.stateHash, sha256(state)), gt(oauthStates.expiresAt, new Date())))
    .returning();
  if (!row) throw new AppError('BAD_REQUEST', 'This sign-in link has expired. Please try again.');
  return row;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
}

export function decodeJwtPayload<T = Record<string, unknown>>(jwt: string | undefined): T | null {
  if (!jwt) return null;
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export async function exchangeGoogleCode(code: string, verifier: string): Promise<TokenResponse> {
  const cfg = getConfig();
  const res = await externalFetch<TokenResponse>({
    service: 'oauth',
    operation: 'google.token',
    url: cfg.GOOGLE_TOKEN_URL,
    method: 'POST',
    form: {
      code,
      client_id: cfg.GOOGLE_CLIENT_ID!,
      client_secret: cfg.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri('google'),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    },
    retries: 0,
  });
  return res.data;
}

export async function exchangeMicrosoftCode(code: string, verifier: string): Promise<TokenResponse> {
  const cfg = getConfig();
  const res = await externalFetch<TokenResponse>({
    service: 'oauth',
    operation: 'microsoft.token',
    url: `${cfg.MICROSOFT_LOGIN_BASE_URL.replace(/\/$/, '')}/${cfg.MICROSOFT_TENANT}/oauth2/v2.0/token`,
    method: 'POST',
    form: {
      code,
      client_id: cfg.MICROSOFT_CLIENT_ID!,
      client_secret: cfg.MICROSOFT_CLIENT_SECRET!,
      redirect_uri: redirectUri('microsoft'),
      grant_type: 'authorization_code',
      code_verifier: verifier,
      scope: MICROSOFT_SCOPES.join(' '),
    },
    retries: 0,
  });
  return res.data;
}

export interface GoogleIdClaims {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  aud?: string;
  iss?: string;
}

/**
 * The ID token is received directly from Google's token endpoint over TLS in
 * exchange for a single-use code and our client secret, so its claims can be
 * trusted without separate signature verification. We still check audience
 * and issuer.
 */
export function googleClaims(tokens: TokenResponse): GoogleIdClaims {
  const claims = decodeJwtPayload<GoogleIdClaims>(tokens.id_token);
  const cfg = getConfig();
  if (!claims?.sub || !claims.email) throw new AppError('INTEGRATION_ERROR', 'Google did not return an email address for this account.');
  if (claims.aud && claims.aud !== cfg.GOOGLE_CLIENT_ID) throw new AppError('INTEGRATION_ERROR', 'Google returned a token for a different application.');
  if (claims.iss && !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) && !cfg.GOOGLE_OAUTH_BASE_URL.startsWith('http://')) {
    throw new AppError('INTEGRATION_ERROR', 'Google returned a token from an unexpected issuer.');
  }
  return claims;
}

export interface MicrosoftClaims {
  oid?: string;
  sub?: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  aud?: string;
}

export function microsoftClaims(tokens: TokenResponse): MicrosoftClaims {
  const claims = decodeJwtPayload<MicrosoftClaims>(tokens.id_token);
  if (!claims) throw new AppError('INTEGRATION_ERROR', 'Microsoft did not return account details.');
  const cfg = getConfig();
  if (claims.aud && claims.aud !== cfg.MICROSOFT_CLIENT_ID) throw new AppError('INTEGRATION_ERROR', 'Microsoft returned a token for a different application.');
  return claims;
}
