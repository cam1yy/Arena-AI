import MailComposer from 'nodemailer/lib/mail-composer';
import type { OutgoingEmail } from './types';

/** Builds an RFC 5322 message (used for Gmail's raw send API). */
export async function buildMime(email: OutgoingEmail): Promise<Buffer> {
  const composer = new MailComposer({
    from: email.from.name ? { name: email.from.name, address: email.from.email } : email.from.email,
    to: email.to,
    replyTo: email.replyTo ?? undefined,
    subject: email.subject,
    text: email.text,
    html: email.html,
    messageId: email.messageId,
    inReplyTo: email.inReplyTo ?? undefined,
    references: email.references?.length ? email.references : undefined,
    headers: email.headers,
  });
  return composer.compile().build();
}

export function generateMessageId(domainFrom: string): string {
  const domain = domainFrom.split('@')[1] ?? 'localy.local';
  const rand = crypto.randomUUID().replace(/-/g, '');
  return `<${rand}.${Date.now().toString(36)}@${domain}>`;
}

export function stripQuotedText(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/i.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From:\s.+/i.test(line.trim()) && out.length > 0) break;
    if (line.trim().startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseAddress(value: string | null | undefined): { email: string; name: string | null } {
  if (!value) return { email: '', name: null };
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim().toLowerCase(), name: m[1].trim() || null };
  return { email: value.trim().toLowerCase(), name: null };
}

export function isBounceSender(from: string, subject: string): boolean {
  const f = from.toLowerCase();
  return (
    f.startsWith('mailer-daemon@') ||
    f.startsWith('postmaster@') ||
    /^(undeliverable|delivery status notification|mail delivery (failed|subsystem)|returned mail|delivery failure)/i.test(subject.trim())
  );
}
