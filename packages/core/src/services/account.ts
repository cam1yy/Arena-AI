import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  campaigns,
  emailMessages,
  subscriptions,
  users,
  workspaceMembers,
  workspaces,
  type Database,
} from '@localy/database';
import { resolvePreferences } from './notifications';
import type { NotificationPreferences } from '@localy/shared';
import { AppError, badRequest, forbidden } from '../errors';
import { verifyPassword } from '../crypto';
import { audit } from '../audit';
import type { ActorContext, WorkspaceContext } from '../context';
import { assertCan } from '../permissions';
import { logger } from '../logger';
import { getWorkspace } from './workspaces';
import { stripe } from './billing';
import { getConfig } from '@localy/config';

type UserRow = typeof users.$inferSelect;

export async function updateProfile(ctx: ActorContext & { userId: string }, input: { name: string; timezone: string; distanceUnit?: 'km' | 'mi' }) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
  } catch {
    throw badRequest('Choose a valid timezone.');
  }
  const [u] = await ctx.db
    .update(users)
    .set({ name: input.name, timezone: input.timezone, ...(input.distanceUnit ? { distanceUnit: input.distanceUnit } : {}) })
    .where(eq(users.id, ctx.userId))
    .returning();
  await audit(ctx.db, ctx, { action: 'settings.profile_updated', targetType: 'user', targetId: ctx.userId });
  return u;
}

export async function updateAvatar(ctx: ActorContext & { userId: string }, dataUrl: string | null) {
  if (dataUrl !== null) {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw badRequest('Upload a PNG, JPEG or WebP image.');
    if (dataUrl.length > 350_000) throw badRequest('Choose an image smaller than 250 KB.');
  }
  await ctx.db.update(users).set({ avatarUrl: dataUrl }).where(eq(users.id, ctx.userId));
}

export async function updateNotificationPreferences(ctx: ActorContext & { userId: string }, prefs: Partial<NotificationPreferences>) {
  const [u] = await ctx.db.select({ p: users.notificationPreferences }).from(users).where(eq(users.id, ctx.userId));
  const merged = { ...resolvePreferences(u?.p), ...prefs };
  await ctx.db.update(users).set({ notificationPreferences: merged }).where(eq(users.id, ctx.userId));
  await audit(ctx.db, ctx, { action: 'settings.notifications_updated', targetType: 'user', targetId: ctx.userId });
  return merged;
}

async function cancelStripeFor(db: Database, workspaceId: string) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  if (sub?.stripeSubscriptionId && getConfig().features.stripe) {
    try {
      await stripe().subscriptions.cancel(sub.stripeSubscriptionId);
    } catch (err) {
      logger.error({ err, workspaceId }, 'failed to cancel Stripe subscription during deletion');
      throw new AppError('EXTERNAL_SERVICE_ERROR', 'We could not cancel the Stripe subscription. Please try again, or cancel it from Billing first.');
    }
  }
}

async function haltSending(db: Database, workspaceId: string) {
  await db.update(campaigns).set({ status: 'paused', pauseReason: 'Workspace scheduled for deletion' }).where(and(eq(campaigns.workspaceId, workspaceId), inArray(campaigns.status, ['active', 'scheduled'])));
  await db.update(emailMessages).set({ status: 'cancelled', error: 'Workspace deleted' }).where(and(eq(emailMessages.workspaceId, workspaceId), eq(emailMessages.status, 'queued')));
}

/** Deletes a workspace and all of its data. Owner only, with typed confirmation. */
export async function deleteWorkspace(ctx: WorkspaceContext, confirmName: string) {
  assertCan(ctx, 'workspace.delete', 'Only the workspace owner can delete the workspace.');
  const ws = await getWorkspace(ctx.db, ctx.workspaceId);
  if (confirmName.trim() !== ws.name) throw badRequest('Type the workspace name exactly to confirm.');
  const memberships = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(eq(workspaceMembers.userId, ctx.userId!));
  if ((memberships[0]?.n ?? 0) <= 1) throw badRequest('This is your only workspace. Delete your account instead, or create another workspace first.');
  await haltSending(ctx.db, ws.id);
  await cancelStripeFor(ctx.db, ws.id);
  await audit(ctx.db, ctx, { action: 'workspace.deleted', workspaceId: null, targetType: 'workspace', targetId: ws.id, metadata: { name: ws.name } });
  await ctx.db.delete(workspaces).where(eq(workspaces.id, ws.id));
}

/**
 * Deletes the user's account. Workspaces the user owns alone are deleted with
 * all their data; workspaces with other members require ownership transfer.
 */
export async function deleteAccount(ctx: ActorContext & { userId: string }, user: UserRow, input: { password?: string; confirm: string }) {
  if (input.confirm !== 'DELETE') throw badRequest('Type DELETE to confirm.');
  if (user.passwordHash && !(await verifyPassword(user.passwordHash, input.password ?? ''))) {
    throw new AppError('UNAUTHENTICATED', 'Your password is incorrect.', { details: { fields: { password: ['Your password is incorrect.'] } } });
  }
  if (user.isPlatformAdmin) throw forbidden('Platform administrators must be demoted before deleting their account.');
  const owned = await ctx.db
    .select({ workspaceId: workspaceMembers.workspaceId, name: workspaces.name })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, user.id), eq(workspaceMembers.role, 'owner')));
  const blocking: string[] = [];
  for (const w of owned) {
    const [others] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, w.workspaceId), ne(workspaceMembers.userId, user.id)));
    if ((others?.n ?? 0) > 0) blocking.push(w.name);
  }
  if (blocking.length) {
    throw new AppError('CONFLICT', `Transfer ownership of ${blocking.join(', ')} to another member before deleting your account.`, { details: { workspaces: blocking } });
  }
  for (const w of owned) {
    await haltSending(ctx.db, w.workspaceId);
    await cancelStripeFor(ctx.db, w.workspaceId);
  }
  await audit(ctx.db, ctx, { action: 'account.deleted', targetType: 'user', targetId: user.id, metadata: { email: user.email, workspacesDeleted: owned.length } });
  await ctx.db.transaction(async (tx) => {
    for (const w of owned) await tx.delete(workspaces).where(eq(workspaces.id, w.workspaceId));
    await tx.delete(users).where(eq(users.id, user.id));
  });
}

/** Exports everything Localy holds about the user and their current workspace (user-created data only). */
export async function exportAccountData(ctx: WorkspaceContext, user: UserRow) {
  assertCan(ctx, 'data.export', 'Only owners and admins can export workspace data.');
  const ws = await getWorkspace(ctx.db, ctx.workspaceId);
  const db = ctx.db;
  const q = (table: string) => sql.raw(table);
  const tables = ['prospects', 'tags', 'notes', 'email_templates', 'campaigns', 'follow_ups', 'saved_searches', 'suppressions'];
  const data: Record<string, unknown[]> = {};
  for (const t of tables) {
    const res = await db.execute(sql`select * from ${q(t)} where workspace_id = ${ws.id} limit 50000`);
    data[t] = res.rows;
  }
  const steps = await db.execute(sql`select s.* from campaign_steps s join campaigns c on c.id = s.campaign_id where c.workspace_id = ${ws.id}`);
  data.campaign_steps = steps.rows;
  const msgs = await db.execute(
    sql`select id, direction, status, from_email, to_email, subject, body_text, sent_at, received_at, campaign_id, prospect_id, step_position, created_at from email_messages where workspace_id = ${ws.id} and is_test = false limit 50000`,
  );
  data.email_messages = msgs.rows;
  const pt = await db.execute(sql`select pt.* from prospect_tags pt join prospects p on p.id = pt.prospect_id where p.workspace_id = ${ws.id}`);
  data.prospect_tags = pt.rows;
  await audit(ctx.db, ctx, { action: 'data.exported', workspaceId: ws.id, metadata: { kind: 'full' } });
  return {
    exportedAt: new Date().toISOString(),
    notice:
      'This export contains data you created in Localy and Localy workflow data. Business details from Google Maps (names, addresses, phone numbers, ratings, hours, websites) are not stored by Localy and are therefore not included; Google place IDs are included so you can look businesses up again.',
    user: { id: user.id, name: user.name, email: user.email, timezone: user.timezone, createdAt: user.createdAt },
    workspace: { id: ws.id, name: ws.name, settings: ws.settings, createdAt: ws.createdAt },
    data,
  };
}
