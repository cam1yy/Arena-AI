import { eq } from 'drizzle-orm';
import { getConfig } from '@localy/config';
import { prospects, users, workspaces, type DbOrTx } from '@localy/database';
import { renderEmail, textToHtml, type PlaceResult, type TemplateVariables } from '@localy/shared';
import { signUnsubscribeToken } from '../crypto';
import { getPlaceDetails } from '../google/places';
import { resolveSettings } from './workspaces';

type ProspectRow = typeof prospects.$inferSelect;

export interface SenderContext {
  senderName: string;
  agencyName: string;
  signature: string | null;
  postalAddress: string | null;
  includeUnsubscribeFooter: boolean;
}

export async function senderContext(db: DbOrTx, workspaceId: string, opts: { senderName?: string | null; userId?: string | null } = {}): Promise<SenderContext> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  const settings = resolveSettings(ws?.settings);
  let userName: string | null = null;
  if (!opts.senderName && !settings.defaultSenderName && opts.userId) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, opts.userId));
    userName = u?.name ?? null;
  }
  return {
    senderName: opts.senderName || settings.defaultSenderName || userName || settings.agencyName || ws?.name || '',
    agencyName: settings.agencyName || ws?.name || '',
    signature: settings.signature,
    postalAddress: settings.postalAddress,
    includeUnsubscribeFooter: settings.includeUnsubscribeFooter,
  };
}

/**
 * Builds template variables for a prospect. User-entered values take priority;
 * Google listing details are fetched live when needed and are not stored.
 */
export async function variablesForProspect(
  p: ProspectRow,
  sender: SenderContext,
  opts: { live?: PlaceResult | null; fetchLive?: boolean } = {},
): Promise<{ vars: TemplateVariables; live: PlaceResult | null }> {
  let live = opts.live ?? null;
  const needsLive = !p.name || !p.categoryLabel || !p.locationLabel;
  if (!live && needsLive && p.placeId && opts.fetchLive !== false) {
    live = await getPlaceDetails(p.placeId, { workspaceId: p.workspaceId });
  }
  const liveCategory = live?.category ? live.category.toLowerCase() : null;
  return {
    live,
    vars: {
      firstName: p.contactFirstName,
      lastName: p.contactLastName,
      businessName: p.name || live?.name || null,
      category: p.categoryLabel || liveCategory,
      location: p.locationLabel || live?.locality || null,
      senderName: sender.senderName,
      agencyName: sender.agencyName,
    },
  };
}

export function unsubscribeUrl(workspaceId: string, email: string, prospectId: string | null): string {
  return `${getConfig().API_URL.replace(/\/$/, '')}/u/${signUnsubscribeToken(workspaceId, email, prospectId)}`;
}

export interface ComposedEmail {
  subject: string;
  text: string;
  html: string;
  missing: string[];
  unsubscribe: string | null;
}

/** Renders the final outgoing email: personalized content, signature and compliance footer. */
export function composeEmail(
  subjectTemplate: string,
  bodyTemplate: string,
  vars: TemplateVariables,
  sender: SenderContext,
  opts: { workspaceId: string; toEmail: string; prospectId: string | null; includeFooter?: boolean },
): ComposedEmail {
  const rendered = renderEmail(subjectTemplate, bodyTemplate, vars);
  let text = rendered.body.trim();
  if (sender.signature?.trim()) text += `\n\n${sender.signature.trim()}`;
  const includeFooter = opts.includeFooter ?? sender.includeUnsubscribeFooter;
  const unsubscribe = includeFooter ? unsubscribeUrl(opts.workspaceId, opts.toEmail, opts.prospectId) : null;
  let footerText = '';
  let footerHtml = '';
  if (includeFooter) {
    const lines = [sender.postalAddress?.trim(), `If you'd prefer not to hear from me again, you can unsubscribe here: ${unsubscribe}`].filter(Boolean) as string[];
    footerText = `\n\n--\n${lines.join('\n')}`;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    footerHtml = `<p style="margin:24px 0 0 0;font-size:12px;color:#737373">${sender.postalAddress ? `${esc(sender.postalAddress.trim())}<br>` : ''}If you'd prefer not to hear from me again, you can <a href="${unsubscribe}" style="color:#737373">unsubscribe</a>.</p>`;
  }
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">${textToHtml(text)}${footerHtml}</div>`;
  return { subject: rendered.subject, text: text + footerText, html, missing: rendered.missing, unsubscribe };
}
