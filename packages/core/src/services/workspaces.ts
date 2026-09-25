import { and, eq, gt, isNull, sql, ne } from 'drizzle-orm';
import { getConfig } from '@localy/config';
import {
  emailTemplates,
  sessions,
  subscriptions,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
  type Database,
  type DbOrTx,
} from '@localy/database';
import {
  DEFAULT_FOLLOW_UP_TEMPLATES,
  DEFAULT_TEMPLATE,
  type Role,
  type WorkspaceSettings,
  type WorkspaceSummary,
} from '@localy/shared';
import { AppError, badRequest, forbidden, notFound } from '../errors';
import { randomToken, sha256 } from '../crypto';
import { audit } from '../audit';
import type { ActorContext, WorkspaceContext } from '../context';
import { assertCan } from '../permissions';
import { invitationEmail, queueSystemMail } from './system-mail';
import { assertWithinLimit } from './usage';

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  agencyName: null,
  website: null,
  industry: null,
  businessLocation: null,
  defaultSenderName: null,
  defaultReplyTo: null,
  signature: null,
  postalAddress: null,
  includeUnsubscribeFooter: true,
  useCase: null,
  defaultLocation: null,
  preferredLocations: [],
  defaultRadiusMeters: 10_000,
  defaultCategories: [],
  minRating: null,
  maxRating: null,
  websiteFilter: 'opportunity',
  distanceUnit: 'km',
};

export function resolveSettings(partial: Partial<WorkspaceSettings> | null | undefined): WorkspaceSettings {
  return { ...DEFAULT_WORKSPACE_SETTINGS, ...(partial ?? {}) };
}

export async function createWorkspace(tx: DbOrTx, input: { name: string; ownerId: string; isDevData?: boolean }) {
  const [ws] = await tx
    .insert(workspaces)
    .values({ name: input.name, settings: {}, isDevData: input.isDevData ?? false })
    .returning();
  await tx.insert(workspaceMembers).values({ workspaceId: ws.id, userId: input.ownerId, role: 'owner' });
  await tx.insert(subscriptions).values({
    workspaceId: ws.id,
    planKey: 'trial',
    status: 'trialing',
    trialEndsAt: new Date(Date.now() + getConfig().TRIAL_DAYS * 24 * 60 * 60 * 1000),
  });
  await tx.insert(emailTemplates).values([
    { workspaceId: ws.id, name: DEFAULT_TEMPLATE.name, subject: DEFAULT_TEMPLATE.subject, body: DEFAULT_TEMPLATE.body, kind: 'initial', createdBy: input.ownerId },
    ...DEFAULT_FOLLOW_UP_TEMPLATES.map((t) => ({
      workspaceId: ws.id,
      name: t.name,
      subject: t.subject,
      body: t.body,
      kind: 'follow_up' as const,
      defaultDelayDays: t.delayDays,
      createdBy: input.ownerId,
    })),
  ]);
  return ws;
}

export async function listUserWorkspaces(db: Database, userId: string): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.name);
  return rows;
}

export async function getMembership(db: DbOrTx, workspaceId: string, userId: string): Promise<Role | null> {
  const [m] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return m?.role ?? null;
}

export async function switchWorkspace(db: Database, sessionId: string, userId: string, workspaceId: string) {
  const role = await getMembership(db, workspaceId, userId);
  if (!role) throw notFound('Workspace');
  await db.update(sessions).set({ activeWorkspaceId: workspaceId }).where(eq(sessions.id, sessionId));
  return role;
}

export async function getWorkspace(db: DbOrTx, workspaceId: string) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) throw notFound('Workspace');
  return ws;
}

export async function updateWorkspaceSettings(ctx: WorkspaceContext, patch: Partial<WorkspaceSettings> & { name?: string }) {
  assertCan(ctx, 'workspace.update', 'Only workspace owners and admins can change workspace settings.');
  const ws = await getWorkspace(ctx.db, ctx.workspaceId);
  const { name, ...settingsPatch } = patch;
  const cleaned = Object.fromEntries(Object.entries(settingsPatch).filter(([, v]) => v !== undefined));
  const settings = { ...(ws.settings ?? {}), ...cleaned };
  const [updated] = await ctx.db
    .update(workspaces)
    .set({ name: name ?? ws.name, settings })
    .where(eq(workspaces.id, ctx.workspaceId))
    .returning();
  await audit(ctx.db, ctx, {
    action: 'workspace.updated',
    workspaceId: ctx.workspaceId,
    targetType: 'workspace',
    targetId: ctx.workspaceId,
    metadata: { fields: [...Object.keys(cleaned), ...(name ? ['name'] : [])] },
  });
  return { ...updated, settings: resolveSettings(updated.settings) };
}

/** Settings that any member may update as part of onboarding. */
export async function mergeOnboardingSettings(db: DbOrTx, workspaceId: string, patch: Partial<WorkspaceSettings>) {
  const ws = await getWorkspace(db, workspaceId);
  const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  await db.update(workspaces).set({ settings: { ...(ws.settings ?? {}), ...cleaned } }).where(eq(workspaces.id, workspaceId));
}

// ---------------------------------------------------------------------------
// Members and invitations
// ---------------------------------------------------------------------------

export async function listMembers(ctx: WorkspaceContext) {
  assertCan(ctx, 'members.read');
  const members = await ctx.db
    .select({
      id: workspaceMembers.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, ctx.workspaceId))
    .orderBy(workspaceMembers.createdAt);
  const invitations = await ctx.db
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      createdAt: workspaceInvitations.createdAt,
      expiresAt: workspaceInvitations.expiresAt,
    })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, ctx.workspaceId),
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.revokedAt),
        gt(workspaceInvitations.expiresAt, new Date()),
      ),
    );
  return {
    members: members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() })),
    invitations: invitations.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString() })),
  };
}

export async function inviteMember(ctx: WorkspaceContext, input: { email: string; role: 'admin' | 'member' }) {
  assertCan(ctx, 'members.manage', 'Only owners and admins can invite members.');
  if (input.role === 'admin' && ctx.role !== 'owner' && ctx.role !== 'admin') throw forbidden();
  const [existingMember] = await ctx.db
    .select({ id: users.id })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), sql`lower(${users.email}) = ${input.email.toLowerCase()}`))
    .limit(1);
  if (existingMember) throw new AppError('CONFLICT', 'This person is already a member of the workspace.');
  const [{ pending }] = await ctx.db
    .select({ pending: sql<number>`count(*)::int` })
    .from(workspaceInvitations)
    .where(and(eq(workspaceInvitations.workspaceId, ctx.workspaceId), isNull(workspaceInvitations.acceptedAt), isNull(workspaceInvitations.revokedAt), gt(workspaceInvitations.expiresAt, new Date())));
  await assertWithinLimit(ctx.db, ctx.workspaceId, 'seats', 1 + pending);
  // Revoke older pending invitations for the same address.
  await ctx.db
    .update(workspaceInvitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(workspaceInvitations.workspaceId, ctx.workspaceId), sql`lower(${workspaceInvitations.email}) = ${input.email.toLowerCase()}`, isNull(workspaceInvitations.acceptedAt)));
  const token = randomToken(32);
  const [inv] = await ctx.db
    .insert(workspaceInvitations)
    .values({
      workspaceId: ctx.workspaceId,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash: sha256(token),
      invitedBy: ctx.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning();
  const ws = await getWorkspace(ctx.db, ctx.workspaceId);
  const [inviter] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId!));
  await queueSystemMail(invitationEmail(input.email, inviter?.name ?? 'A teammate', ws.name, token));
  await audit(ctx.db, ctx, { action: 'member.invited', workspaceId: ctx.workspaceId, targetType: 'invitation', targetId: inv.id, metadata: { email: input.email, role: input.role } });
  return { id: inv.id };
}

export async function revokeInvitation(ctx: WorkspaceContext, invitationId: string) {
  assertCan(ctx, 'members.manage');
  const res = await ctx.db
    .update(workspaceInvitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(workspaceInvitations.id, invitationId), eq(workspaceInvitations.workspaceId, ctx.workspaceId)))
    .returning({ id: workspaceInvitations.id });
  if (!res.length) throw notFound('Invitation');
  await audit(ctx.db, ctx, { action: 'member.invitation_revoked', workspaceId: ctx.workspaceId, targetType: 'invitation', targetId: invitationId });
}

export async function describeInvitation(db: Database, token: string) {
  const [inv] = await db
    .select({ id: workspaceInvitations.id, email: workspaceInvitations.email, role: workspaceInvitations.role, workspaceName: workspaces.name })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .where(and(eq(workspaceInvitations.tokenHash, sha256(token)), isNull(workspaceInvitations.acceptedAt), isNull(workspaceInvitations.revokedAt), gt(workspaceInvitations.expiresAt, new Date())))
    .limit(1);
  if (!inv) throw badRequest('This invitation is invalid, has expired, or was already used.');
  return inv;
}

export async function acceptInvitation(ctx: ActorContext & { userId: string }, token: string, userEmail: string) {
  const [inv] = await ctx.db
    .select()
    .from(workspaceInvitations)
    .where(and(eq(workspaceInvitations.tokenHash, sha256(token)), isNull(workspaceInvitations.acceptedAt), isNull(workspaceInvitations.revokedAt), gt(workspaceInvitations.expiresAt, new Date())))
    .limit(1);
  if (!inv) throw badRequest('This invitation is invalid, has expired, or was already used.');
  if (inv.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that email address to accept it.`);
  }
  await ctx.db.transaction(async (tx) => {
    await tx.update(workspaceInvitations).set({ acceptedAt: new Date() }).where(eq(workspaceInvitations.id, inv.id));
    await tx.insert(workspaceMembers).values({ workspaceId: inv.workspaceId, userId: ctx.userId, role: inv.role }).onConflictDoNothing();
    // Joining a workspace that is already set up counts as completing onboarding.
    await tx.update(users).set({ onboardingCompletedAt: sql`coalesce(${users.onboardingCompletedAt}, now())`, onboardingStep: 6 }).where(eq(users.id, ctx.userId));
  });
  await audit(ctx.db, ctx, { action: 'member.joined', workspaceId: inv.workspaceId, targetType: 'user', targetId: ctx.userId });
  return { workspaceId: inv.workspaceId };
}

export async function changeMemberRole(ctx: WorkspaceContext, memberUserId: string, role: Role) {
  assertCan(ctx, 'members.manage');
  const current = await getMembership(ctx.db, ctx.workspaceId, memberUserId);
  if (!current) throw notFound('Member');
  if (role === 'owner' || current === 'owner') {
    if (ctx.role !== 'owner') throw forbidden('Only the workspace owner can transfer ownership.');
    if (role === 'owner') {
      if (memberUserId === ctx.userId) return;
      await ctx.db.transaction(async (tx) => {
        await tx.update(workspaceMembers).set({ role: 'admin' }).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, ctx.userId!)));
        await tx.update(workspaceMembers).set({ role: 'owner' }).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, memberUserId)));
      });
      await audit(ctx.db, ctx, { action: 'workspace.ownership_transferred', workspaceId: ctx.workspaceId, targetType: 'user', targetId: memberUserId });
      return;
    }
    throw badRequest('Transfer ownership to another member before changing the owner role.');
  }
  await ctx.db.update(workspaceMembers).set({ role }).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, memberUserId)));
  await audit(ctx.db, ctx, { action: 'member.role_changed', workspaceId: ctx.workspaceId, targetType: 'user', targetId: memberUserId, metadata: { from: current, to: role } });
}

export async function removeMember(ctx: WorkspaceContext, memberUserId: string) {
  const isSelf = memberUserId === ctx.userId;
  if (!isSelf) assertCan(ctx, 'members.manage');
  const current = await getMembership(ctx.db, ctx.workspaceId, memberUserId);
  if (!current) throw notFound('Member');
  if (current === 'owner') throw badRequest('The owner cannot leave or be removed. Transfer ownership first, or delete the workspace.');
  if (current === 'admin' && ctx.role === 'admin' && !isSelf) throw forbidden('Admins cannot remove other admins.');
  await ctx.db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, memberUserId)));
  await ctx.db.update(sessions).set({ activeWorkspaceId: null }).where(and(eq(sessions.userId, memberUserId), eq(sessions.activeWorkspaceId, ctx.workspaceId)));
  await audit(ctx.db, ctx, { action: 'member.removed', workspaceId: ctx.workspaceId, targetType: 'user', targetId: memberUserId });
}

export async function createAdditionalWorkspace(ctx: ActorContext & { userId: string }, name: string) {
  const ws = await ctx.db.transaction((tx) => createWorkspace(tx, { name, ownerId: ctx.userId }));
  await audit(ctx.db, ctx, { action: 'workspace.created', workspaceId: ws.id, targetType: 'workspace', targetId: ws.id });
  return ws;
}

export async function otherOwnedWorkspaceCount(db: Database, userId: string, excludeWorkspaceId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.role, 'owner'), ne(workspaceMembers.workspaceId, excludeWorkspaceId)));
  return r?.n ?? 0;
}
