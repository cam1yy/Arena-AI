import { getConfig } from '@localy/config';
import { htmlToText, isBounceSender } from '../mime';
import type { EmailProvider, InboundMessage, OutgoingEmail, ProviderCredentials, ProviderTokens, SendResult, SyncResult } from '../types';
import { ProviderError } from '../types';
import { providerFetch } from './http';

/*
 * Microsoft Outlook / Microsoft 365 via Microsoft Graph with OAuth 2.0.
 * Scopes: Mail.Send (send as the user), Mail.Read (detect replies and
 * bounces) and offline_access (refresh tokens).
 */
export const MICROSOFT_SCOPES = ['openid', 'email', 'profile', 'offline_access', 'User.Read', 'Mail.Send', 'Mail.Read'];

interface GraphMessage {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  body?: { contentType?: string; content?: string };
  internetMessageHeaders?: { name: string; value: string }[];
}

function base() {
  return getConfig().MICROSOFT_GRAPH_BASE_URL.replace(/\/$/, '');
}

function authHeaders(creds: ProviderCredentials) {
  if (!creds.accessToken) throw new ProviderError('Microsoft access token is missing. Reconnect the mailbox.', 'auth');
  return { Authorization: `Bearer ${creds.accessToken}` };
}

export const microsoftProvider: EmailProvider = {
  id: 'microsoft',
  label: 'Microsoft Outlook',
  scopes: MICROSOFT_SCOPES,
  capabilities: { deliveryConfirmation: false, opens: false, replies: true, bounces: true },

  async send(creds: ProviderCredentials, email: OutgoingEmail): Promise<SendResult> {
    const headers = [
      ...(email.inReplyTo ? [{ name: 'X-Localy-In-Reply-To', value: email.inReplyTo }] : []),
      ...Object.entries(email.headers ?? {})
        .filter(([k]) => k.toLowerCase().startsWith('x-'))
        .map(([name, value]) => ({ name, value })),
    ];
    // Graph generates its own Message-ID for sendMail. We create a draft first
    // so we can record the provider's IDs, then send it.
    const draft = await providerFetch<GraphMessage>(`${base()}/v1.0/me/messages`, {
      method: 'POST',
      headers: { ...authHeaders(creds), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: email.subject,
        body: { contentType: 'HTML', content: email.html },
        toRecipients: [{ emailAddress: { address: email.to } }],
        replyTo: email.replyTo ? [{ emailAddress: { address: email.replyTo } }] : undefined,
        internetMessageHeaders: headers.length ? headers : undefined,
      }),
    });
    await providerFetch<null>(`${base()}/v1.0/me/messages/${draft.id}/send`, { method: 'POST', headers: authHeaders(creds) });
    return { providerMessageId: draft.internetMessageId ?? draft.id, providerThreadId: draft.conversationId ?? null };
  },

  async sync(creds: ProviderCredentials, since: Date): Promise<SyncResult> {
    const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
    const select = 'id,conversationId,internetMessageId,subject,receivedDateTime,from,toRecipients,body';
    const res = await providerFetch<{ value?: GraphMessage[] }>(
      `${base()}/v1.0/me/mailFolders/inbox/messages?$filter=${filter}&$top=50&$select=${select}&$orderby=receivedDateTime desc`,
      { headers: { ...authHeaders(creds), Prefer: 'outlook.body-content-type="text"' } },
    );
    const messages: InboundMessage[] = [];
    for (const m of res.value ?? []) {
      const fromEmail = (m.from?.emailAddress?.address ?? '').toLowerCase();
      if (!fromEmail || fromEmail === creds.email.toLowerCase()) continue;
      const subject = m.subject ?? '(no subject)';
      const text = m.body?.contentType === 'html' ? htmlToText(m.body.content ?? '') : (m.body?.content ?? '');
      const isBounce = isBounceSender(fromEmail, subject);
      messages.push({
        providerMessageId: m.internetMessageId ?? m.id,
        providerThreadId: m.conversationId ?? null,
        messageIdHeader: m.internetMessageId ?? null,
        inReplyTo: null,
        references: [],
        fromEmail,
        fromName: m.from?.emailAddress?.name ?? null,
        toEmail: m.toRecipients?.[0]?.emailAddress?.address?.toLowerCase() ?? null,
        subject,
        text,
        receivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
        isBounce,
        bouncedRecipient: isBounce ? (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null) : null,
      });
    }
    return { messages, nextCursor: null };
  },

  async healthCheck(creds: ProviderCredentials) {
    try {
      const me = await providerFetch<{ mail?: string; userPrincipalName?: string }>(`${base()}/v1.0/me?$select=mail,userPrincipalName`, { headers: authHeaders(creds) });
      const email = (me.mail ?? me.userPrincipalName ?? '').toLowerCase();
      return { ok: email === creds.email.toLowerCase(), message: email };
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'auth') return { ok: false, message: 'Authorization expired or was revoked.' };
      throw err;
    }
  },

  async refresh(refreshToken: string): Promise<ProviderTokens> {
    const cfg = getConfig();
    if (!cfg.MICROSOFT_CLIENT_ID || !cfg.MICROSOFT_CLIENT_SECRET) throw new ProviderError('Microsoft OAuth is not configured.', 'permanent');
    const res = await providerFetch<{ access_token: string; expires_in: number; refresh_token?: string }>(
      `${cfg.MICROSOFT_LOGIN_BASE_URL.replace(/\/$/, '')}/${cfg.MICROSOFT_TENANT}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.MICROSOFT_CLIENT_ID,
          client_secret: cfg.MICROSOFT_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          scope: MICROSOFT_SCOPES.join(' '),
        }).toString(),
      },
    );
    return { accessToken: res.access_token, refreshToken: res.refresh_token ?? refreshToken, expiresAt: new Date(Date.now() + (res.expires_in - 60) * 1000) };
  },
};
