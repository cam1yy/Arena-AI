import type { EmailProvider, OutgoingEmail, ProviderCredentials, SendResult, SyncResult } from '../types';

/*
 * Development sandbox mailbox. Never delivers anything: "sent" messages are
 * recorded by Localy exactly like real sends, and replies can be simulated
 * from the Inbox to exercise the reply-detection workflow. The API refuses to
 * create sandbox mailboxes when NODE_ENV=production.
 */
export const sandboxProvider: EmailProvider = {
  id: 'sandbox',
  label: 'Development sandbox',
  scopes: ['sandbox.send', 'sandbox.read'],
  capabilities: { deliveryConfirmation: true, opens: false, replies: true, bounces: true },

  async send(_creds: ProviderCredentials, email: OutgoingEmail): Promise<SendResult> {
    const threadId = email.providerThreadId ?? `sandbox-thread-${crypto.randomUUID()}`;
    if (/@(bounce|invalid)\.test$/i.test(email.to)) {
      const { ProviderError } = await import('../types');
      throw new ProviderError(`Sandbox rejected recipient ${email.to}`, 'invalid_recipient', 550);
    }
    return { providerMessageId: `sandbox-${crypto.randomUUID()}`, providerThreadId: threadId };
  },

  async sync(): Promise<SyncResult> {
    return { messages: [], nextCursor: null };
  },

  async healthCheck() {
    return { ok: true, message: 'Sandbox mailbox' };
  },
};
