import nodemailer, { type Transporter } from 'nodemailer';
import { getConfig } from '@localy/config';
import { devOutbox, getDb } from '@localy/database';
import { logger } from './logger';

/**
 * System email: verification, password reset, invitations and notification
 * digests. This is separate from outreach, which is always sent through the
 * user's connected mailbox. Without SMTP_URL outside production, messages are
 * captured in the development outbox (visible at /dev/mail) instead.
 */
export interface SystemMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | undefined;

export async function deliverSystemMail(mail: SystemMail): Promise<void> {
  const cfg = getConfig();
  if (cfg.SMTP_URL) {
    transporter ??= nodemailer.createTransport(cfg.SMTP_URL);
    await transporter.sendMail({ from: cfg.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    return;
  }
  if (cfg.isProduction) {
    logger.error({ to: mail.to, subject: mail.subject }, 'SMTP_URL is not configured; system email was not sent');
    throw new Error('System email is not configured (SMTP_URL).');
  }
  await getDb().insert(devOutbox).values({ toEmail: mail.to, subject: mail.subject, text: mail.text });
  logger.info({ to: mail.to, subject: mail.subject }, 'system email captured in development outbox');
}

export function systemMailLayout(title: string, paragraphs: string[], action?: { label: string; url: string }): SystemMail['html'] {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html><body style="margin:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:32px">
<tr><td style="font-size:15px;font-weight:600;letter-spacing:-0.01em;padding-bottom:24px">Localy</td></tr>
<tr><td style="font-size:20px;font-weight:600;letter-spacing:-0.02em;padding-bottom:12px">${esc(title)}</td></tr>
${paragraphs.map((p) => `<tr><td style="font-size:14px;line-height:1.6;color:#404040;padding-bottom:12px">${esc(p)}</td></tr>`).join('')}
${action ? `<tr><td style="padding:12px 0 8px"><a href="${action.url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:7px">${esc(action.label)}</a></td></tr><tr><td style="font-size:12px;color:#737373;padding-top:12px;word-break:break-all">${esc(action.url)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}
