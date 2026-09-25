import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { notifications, users, workspaceMembers, type DbOrTx } from '@localy/database';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationItem,
  type NotificationPreferenceKey,
  type NotificationPreferences,
  type NotificationType,
  type Role,
} from '@localy/shared';
import { enqueue, QUEUES } from '../queue';
import { logger } from '../logger';

const PREFERENCE_FOR_TYPE: Partial<Record<NotificationType, NotificationPreferenceKey>> = {
  reply: 'replies',
  campaign_completed: 'campaign_completed',
  follow_up_due: 'follow_ups',
  usage_warning: 'usage_limits',
};

export function resolvePreferences(p: NotificationPreferences | null | undefined): NotificationPreferences {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(p ?? {}) };
}

export interface NewNotification {
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  dedupeKey?: string | null;
}

/**
 * Creates in-app notifications for workspace members (optionally filtered by
 * role), respecting each user's preferences, and queues email copies for users
 * who opted in.
 */
export async function notifyWorkspace(
  db: DbOrTx,
  workspaceId: string,
  n: NewNotification & { roles?: Role[]; alsoUserId?: string | null; onlyUserIds?: string[] },
) {
  try {
    const conds = [eq(workspaceMembers.workspaceId, workspaceId)];
    if (n.roles?.length) conds.push(inArray(workspaceMembers.role, n.roles));
    let recipients = await db
      .select({ userId: users.id, email: users.email, prefs: users.notificationPreferences })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(...conds, isNull(users.disabledAt)));
    if (n.onlyUserIds) recipients = recipients.filter((r) => n.onlyUserIds!.includes(r.userId));
    if (n.alsoUserId && !recipients.some((r) => r.userId === n.alsoUserId)) {
      const [extra] = await db
        .select({ userId: users.id, email: users.email, prefs: users.notificationPreferences })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.id, n.alsoUserId)));
      if (extra) recipients.push(extra);
    }
    const prefKey = PREFERENCE_FOR_TYPE[n.type];
    for (const r of recipients) {
      const prefs = resolvePreferences(r.prefs);
      const wantsInApp = prefKey ? prefs[prefKey].inApp : true;
      const wantsEmail = prefKey ? prefs[prefKey].email : n.type === 'integration_disconnected' || n.type === 'payment_issue';
      if (!wantsInApp && !wantsEmail) continue;
      if (wantsInApp) {
        const inserted = await db
          .insert(notifications)
          .values({ workspaceId, userId: r.userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null })
          .onConflictDoNothing()
          .returning({ id: notifications.id });
        if (n.dedupeKey && !inserted.length) continue;
      }
      if (wantsEmail) {
        await enqueue(QUEUES.notificationEmail, { to: r.email, title: n.title, body: n.body ?? n.title, link: n.link ?? null }, n.dedupeKey ? { singletonKey: `${r.userId}:${n.dedupeKey}` } : {});
      }
    }
  } catch (err) {
    logger.error({ err, type: n.type }, 'failed to create notification');
  }
}

export async function notifyUser(db: DbOrTx, userId: string, workspaceId: string | null, n: NewNotification) {
  await db
    .insert(notifications)
    .values({ workspaceId, userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null })
    .onConflictDoNothing();
}

export async function listNotifications(db: DbOrTx, userId: string, workspaceId: string, limit = 30): Promise<NotificationItem[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), sql`(${notifications.workspaceId} = ${workspaceId} or ${notifications.workspaceId} is null)`))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type as NotificationType,
    title: r.title,
    body: r.body,
    link: r.link,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function unreadCount(db: DbOrTx, userId: string, workspaceId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), sql`(${notifications.workspaceId} = ${workspaceId} or ${notifications.workspaceId} is null)`));
  return r?.n ?? 0;
}

export async function markRead(db: DbOrTx, userId: string, ids: string[] | 'all', workspaceId: string) {
  const base = and(eq(notifications.userId, userId), isNull(notifications.readAt), sql`(${notifications.workspaceId} = ${workspaceId} or ${notifications.workspaceId} is null)`);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(ids === 'all' ? base : and(base, inArray(notifications.id, ids)));
}

export async function broadcastSystemNotification(db: DbOrTx, title: string, body: string | null) {
  const all = await db.select({ id: users.id }).from(users).where(isNull(users.disabledAt));
  const dedupeKey = `system:${title}:${new Date().toISOString().slice(0, 10)}`;
  for (let i = 0; i < all.length; i += 500) {
    await db
      .insert(notifications)
      .values(all.slice(i, i + 500).map((u) => ({ userId: u.id, workspaceId: null, type: 'system', title, body, dedupeKey })))
      .onConflictDoNothing();
  }
  return all.length;
}
