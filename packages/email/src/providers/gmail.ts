import { getConfig } from '@localy/config';
import { buildMime, htmlToText, isBounceSender, parseAddress } from '../mime';
import type { EmailProvider, InboundMessage, OutgoingEmail, ProviderCredentials, ProviderTokens, SendResult, SyncResult } from '../types';
import { ProviderError } from '../types';
import { providerFetch } from './http';

/*
 * Gmail / Google Workspace via the Gmail API with OAuth 2.0.
 * Scopes: gmail.send (send as the user) and gmail.readonly (detect replies and
 * bounces). Localy never receives or stores the user's Google password.
 */
export const GMAIL_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
  headers?: GmailHeader[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
  snippet?: string;
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (data?: string) => (data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '');

function findPart(part: GmailPart | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return decode(part.body.data);
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

function header(msg: GmailMessage, name: string): string | null {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function base() {
  return getConfig().GMAIL_API_BASE_URL.replace(/\/$/, '');
}

function authHeaders(creds: ProviderCredentials) {
  if (!creds.accessToken) throw new ProviderError('Gmail access token is missing. Reconnect the mailbox.', 'auth');
  return { Authorization: `Bearer ${creds.accessToken}` };
}

export const gmailProvider: EmailProvider = {
  id: 'gmail',
  label: 'Gmail',
  scopes: GMAIL_SCOPES,
  capabilities: { deliveryConfirmation: false, opens: false, replies: true, bounces: true },

  async send(creds: ProviderCredentials, email: OutgoingEmail): Promise<SendResult> {
    const raw = b64url(await buildMime(email));
    const body: Record<string, string> = { raw };
    if (email.providerThreadId) body.threadId = email.providerThreadId;
    const res = await providerFetch<{ id: string; threadId: string }>(`${base()}/gmail/v1/users/me/messages/send`, {
      method: 'POST',
      headers: { ...authHeaders(creds), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { providerMessageId: res.id, providerThreadId: res.threadId };
  },

  async sync(creds: ProviderCredentials, since: Date): Promise<SyncResult> {
    const after = Math.floor(since.getTime() / 1000);
    const q = encodeURIComponent(`in:inbox after:${after} -from:me`);
    const list = await providerFetch<{ messages?: { id: string; threadId: string }[] }>(
      `${base()}/gmail/v1/users/me/messages?q=${q}&maxResults=50`,
      { headers: authHeaders(creds) },
    );
    const messages: InboundMessage[] = [];
    for (const ref of list.messages ?? []) {
      const msg = await providerFetch<GmailMessage>(`${base()}/gmail/v1/users/me/messages/${ref.id}?format=full`, { headers: authHeaders(creds) });
      const from = parseAddress(header(msg, 'From'));
      const subject = header(msg, 'Subject') ?? '(no subject)';
      const text = findPart(msg.payload, 'text/plain') ?? htmlToText(findPart(msg.payload, 'text/html') ?? msg.snippet ?? '');
      const isBounce = isBounceSender(from.email, subject);
      messages.push({
        providerMessageId: msg.id,
        providerThreadId: msg.threadId,
        messageIdHeader: header(msg, 'Message-ID') ?? header(msg, 'Message-Id'),
        inReplyTo: header(msg, 'In-Reply-To'),
        references: (header(msg, 'References') ?? '').split(/\s+/).filter(Boolean),
        fromEmail: from.email,
        fromName: from.name,
        toEmail: parseAddress(header(msg, 'To')).email || null,
        subject,
        text,
        receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
        isBounce,
        bouncedRecipient: isBounce ? (header(msg, 'X-Failed-Recipients') ?? text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null) : null,
      });
    }
    return { messages, nextCursor: null };
  },

  async healthCheck(creds: ProviderCredentials) {
    try {
      const profile = await providerFetch<{ emailAddress: string }>(`${base()}/gmail/v1/users/me/profile`, { headers: authHeaders(creds) });
      return { ok: profile.emailAddress.toLowerCase() === creds.email.toLowerCase(), message: profile.emailAddress };
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'auth') return { ok: false, message: 'Authorization expired or was revoked.' };
      throw err;
    }
  },

  async refresh(refreshToken: string): Promise<ProviderTokens> {
    const cfg = getConfig();
    if (!cfg.GOOGLE_CLIENT_ID || !cfg.GOOGLE_CLIENT_SECRET) throw new ProviderError('Google OAuth is not configured.', 'permanent');
    const res = await providerFetch<{ access_token: string; expires_in: number; refresh_token?: string }>(cfg.GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.GOOGLE_CLIENT_ID,
        client_secret: cfg.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    return { accessToken: res.access_token, refreshToken: res.refresh_token ?? refreshToken, expiresAt: new Date(Date.now() + (res.expires_in - 60) * 1000) };
  },
};
