import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { activities, users, type DbOrTx } from '@localy/database';
import { PROSPECT_STATUS_LABELS, type ActivityItem, type ActivityType, type ProspectStatus } from '@localy/shared';
import type { WorkspaceContext } from '../context';

export interface NewActivity {
  workspaceId: string;
  type: ActivityType;
  prospectId?: string | null;
  campaignId?: string | null;
  actorId?: string | null;
  data?: Record<string, unknown>;
}

export async function recordActivity(db: DbOrTx, a: NewActivity) {
  await db.insert(activities).values({
    workspaceId: a.workspaceId,
    type: a.type,
    prospectId: a.prospectId ?? null,
    campaignId: a.campaignId ?? null,
    actorId: a.actorId ?? null,
    data: a.data ?? {},
  });
}

export async function recordActivities(db: DbOrTx, list: NewActivity[]) {
  if (!list.length) return;
  for (let i = 0; i < list.length; i += 500) {
    await db.insert(activities).values(
      list.slice(i, i + 500).map((a) => ({
        workspaceId: a.workspaceId,
        type: a.type,
        prospectId: a.prospectId ?? null,
        campaignId: a.campaignId ?? null,
        actorId: a.actorId ?? null,
        data: a.data ?? {},
      })),
    );
  }
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' && v ? v : fallback);

export function summarizeActivity(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case 'business_discovered':
      return 'Business discovered';
    case 'prospect_created':
      return data.source === 'manual' ? 'Prospect added manually' : 'Saved as a prospect';
    case 'status_changed':
      return `Status changed to ${PROSPECT_STATUS_LABELS[data.to as ProspectStatus] ?? str(data.to)}`;
    case 'note_added':
      return 'Note added';
    case 'tag_added':
      return `Tagged "${str(data.tag)}"`;
    case 'tag_removed':
      return `Tag "${str(data.tag)}" removed`;
    case 'added_to_campaign':
      return `Added to "${str(data.campaignName, 'a campaign')}"`;
    case 'removed_from_campaign':
      return `Removed from "${str(data.campaignName, 'a campaign')}"`;
    case 'email_sent':
      return data.step && Number(data.step) > 1 ? `Follow-up ${Number(data.step) - 1} sent` : `Email sent${data.subject ? `: ${str(data.subject)}` : ''}`;
    case 'email_failed':
      return `Email failed${data.reason ? `: ${str(data.reason)}` : ''}`;
    case 'email_bounced':
      return 'Email bounced';
    case 'reply_received':
      return 'Reply received';
    case 'follow_up_scheduled':
      return 'Follow-up scheduled';
    case 'follow_up_completed':
      return 'Follow-up completed';
    case 'follow_up_cancelled':
      return 'Follow-up cancelled';
    case 'sequence_stopped':
      return `Sequence stopped${data.campaignName ? ` in "${str(data.campaignName)}"` : ''}${data.reason ? `: ${str(data.reason).toLowerCase()}` : ''}`;
    case 'unsubscribed':
      return 'Unsubscribed from outreach';
    case 'contact_updated':
      return 'Contact details updated';
    case 'campaign_started':
      return `Campaign "${str(data.campaignName)}" started`;
    case 'campaign_paused':
      return `Campaign "${str(data.campaignName)}" paused${data.reason ? `: ${str(data.reason)}` : ''}`;
    case 'campaign_resumed':
      return `Campaign "${str(data.campaignName)}" resumed`;
    case 'campaign_completed':
      return `Campaign "${str(data.campaignName)}" completed`;
    case 'discovery_search': {
      const found = Number(data.found ?? 0);
      return `${found} ${found === 1 ? 'business' : 'businesses'} discovered: ${str(data.label)}`;
    }
    default:
      return type.replace(/_/g, ' ');
  }
}

export async function listActivity(
  ctx: WorkspaceContext,
  opts: { prospectId?: string; campaignId?: string; limit?: number; before?: Date; types?: string[] } = {},
): Promise<ActivityItem[]> {
  const conds = [eq(activities.workspaceId, ctx.workspaceId)];
  if (opts.prospectId) conds.push(eq(activities.prospectId, opts.prospectId));
  if (opts.campaignId) conds.push(eq(activities.campaignId, opts.campaignId));
  if (opts.before) conds.push(lt(activities.createdAt, opts.before));
  if (opts.types?.length) conds.push(inArray(activities.type, opts.types));
  const rows = await ctx.db
    .select({ a: activities, actorName: users.name })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.actorId))
    .where(and(...conds))
    .orderBy(desc(activities.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows.map(({ a, actorName }) => ({
    id: a.id,
    type: a.type,
    data: a.data,
    prospectId: a.prospectId,
    campaignId: a.campaignId,
    actor: a.actorId ? { id: a.actorId, name: actorName ?? 'Former member' } : null,
    createdAt: a.createdAt.toISOString(),
    summary: summarizeActivity(a.type, a.data),
  }));
}
