import type { EmailProvider } from './types';
import { gmailProvider } from './providers/gmail';
import { microsoftProvider } from './providers/microsoft';
import { sandboxProvider } from './providers/sandbox';

const providers: Record<EmailProvider['id'], EmailProvider> = {
  gmail: gmailProvider,
  microsoft: microsoftProvider,
  sandbox: sandboxProvider,
};

export function getProvider(id: EmailProvider['id']): EmailProvider {
  const p = providers[id];
  if (!p) throw new Error(`Unknown email provider: ${id}`);
  return p;
}

export function listProviders(): EmailProvider[] {
  return Object.values(providers);
}
