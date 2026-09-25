import { getConfig } from '@localy/config';
import { enqueue, QUEUES } from '../queue';
import { systemMailLayout, type SystemMail } from '../mailer';

/** Enqueues system email so request latency does not depend on SMTP. */
export async function queueSystemMail(mail: SystemMail): Promise<void> {
  await enqueue(QUEUES.systemMail, mail);
}

const appUrl = (path: string) => `${getConfig().APP_URL.replace(/\/$/, '')}${path}`;

export function verificationEmail(to: string, name: string, token: string): SystemMail {
  const url = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  const lines = [`Hi ${name},`, 'Confirm your email address to finish setting up your Localy account. This link expires in 24 hours.'];
  return {
    to,
    subject: 'Confirm your email for Localy',
    text: `${lines.join('\n\n')}\n\n${url}\n\nIf you did not create a Localy account, you can ignore this email.`,
    html: systemMailLayout('Confirm your email', [...lines, 'If you did not create a Localy account, you can ignore this email.'], {
      label: 'Confirm email',
      url,
    }),
  };
}

export function passwordResetEmail(to: string, token: string): SystemMail {
  const url = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  const lines = [
    'Someone requested a password reset for your Localy account. Use the link below to choose a new password. It expires in 60 minutes.',
    'If you did not request this, you can ignore this email. Your password will not change.',
  ];
  return {
    to,
    subject: 'Reset your Localy password',
    text: `${lines[0]}\n\n${url}\n\n${lines[1]}`,
    html: systemMailLayout('Reset your password', lines, { label: 'Choose a new password', url }),
  };
}

export function emailChangeEmail(to: string, token: string): SystemMail {
  const url = appUrl(`/verify-email?token=${encodeURIComponent(token)}&change=1`);
  const lines = ['Confirm this address to use it as the sign-in email for your Localy account. This link expires in 24 hours.'];
  return {
    to,
    subject: 'Confirm your new Localy email address',
    text: `${lines[0]}\n\n${url}`,
    html: systemMailLayout('Confirm your new email', lines, { label: 'Confirm new email', url }),
  };
}

export function invitationEmail(to: string, inviterName: string, workspaceName: string, token: string): SystemMail {
  const url = appUrl(`/invite?token=${encodeURIComponent(token)}`);
  const lines = [`${inviterName} invited you to join the ${workspaceName} workspace on Localy.`, 'This invitation expires in 7 days.'];
  return {
    to,
    subject: `Join ${workspaceName} on Localy`,
    text: `${lines.join('\n\n')}\n\n${url}`,
    html: systemMailLayout(`Join ${workspaceName}`, lines, { label: 'Accept invitation', url }),
  };
}

export function notificationDigestEmail(to: string, title: string, body: string, link: string | null): SystemMail {
  const url = link ? appUrl(link) : appUrl('/app');
  return {
    to,
    subject: title,
    text: `${body}\n\n${url}\n\nManage notification preferences in Localy under Settings, Notifications.`,
    html: systemMailLayout(title, [body, 'Manage notification preferences in Localy under Settings, Notifications.'], {
      label: 'Open Localy',
      url,
    }),
  };
}
