import { and, eq, gt, isNull, sql, ne } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { getConfig } from '@localy/config';
import {
  authTokens,
  oauthAccounts,
  recoveryCodes,
  sessions,
  users,
  workspaceMembers,
  type Database,
} from '@localy/database';
import { checkPassword, type SessionUser } from '@localy/shared';
import { AppError, badRequest } from '../errors';
import {
  decryptSecret,
  dummyPasswordCheck,
  encryptSecret,
  hashPassword,
  randomToken,
  sha256,
  verifyPassword,
} from '../crypto';
import { audit } from '../audit';
import type { ActorContext } from '../context';
import { createWorkspace } from './workspaces';
import { emailChangeEmail, passwordResetEmail, queueSystemMail, verificationEmail } from './system-mail';

export const SESSION_COOKIE = 'localy_session';
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

type UserRow = typeof users.$inferSelect;

export function toSessionUser(u: UserRow): SessionUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: Boolean(u.emailVerifiedAt),
    avatarUrl: u.avatarUrl,
    timezone: u.timezone,
    distanceUnit: u.distanceUnit,
    twoFactorEnabled: Boolean(u.twoFactorEnabledAt),
    hasPassword: Boolean(u.passwordHash),
    isPlatformAdmin: u.isPlatformAdmin,
    onboardingStep: u.onboardingStep,
    onboardingCompleted: Boolean(u.onboardingCompletedAt),
    createdAt: u.createdAt.toISOString(),
  };
}

export function assertStrongPassword(password: string) {
  const result = checkPassword(password);
  if (!result.valid) {
    throw new AppError('VALIDATION_ERROR', 'Password does not meet the requirements.', {
      details: { fields: { password: result.failed } },
    });
  }
}

export async function findUserByEmail(db: Database, email: string) {
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
  return u;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface CreatedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export async function createSession(
  db: Database,
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null; workspaceId?: string | null; twoFactorPending?: boolean },
): Promise<CreatedSession> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + getConfig().SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  let workspaceId = meta.workspaceId ?? null;
  if (!workspaceId) {
    const [m] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(workspaceMembers.createdAt)
      .limit(1);
    workspaceId = m?.workspaceId ?? null;
  }
  const [s] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      activeWorkspaceId: workspaceId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      twoFactorPending: meta.twoFactorPending ?? false,
      expiresAt,
    })
    .returning({ id: sessions.id });
  return { token, sessionId: s.id, expiresAt };
}

export type SessionRecord = typeof sessions.$inferSelect;

/** Resolves a session token. Expired, revoked or disabled-user sessions return null. */
export async function resolveSession(db: Database, token: string): Promise<{ session: SessionRecord; user: UserRow } | null> {
  if (!token || token.length > 200) return null;
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.user.disabledAt) return null;
  if (Date.now() - row.session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
  }
  return row;
}

export async function revokeSession(db: Database, sessionId: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeOtherSessions(db: Database, userId: string, keepSessionId: string | null) {
  const cond = keepSessionId
    ? and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, keepSessionId))
    : and(eq(sessions.userId, userId), isNull(sessions.revokedAt));
  const res = await db.update(sessions).set({ revokedAt: new Date() }).where(cond).returning({ id: sessions.id });
  return res.length;
}

export async function listSessions(db: Database, userId: string, currentSessionId: string) {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(sql`${sessions.lastSeenAt} desc`);
  return rows.map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === currentSessionId,
  }));
}

// ---------------------------------------------------------------------------
// Sign up / sign in
// ---------------------------------------------------------------------------

export async function signUp(
  ctx: ActorContext,
  input: { name: string; email: string; password: string; workspaceName: string },
): Promise<{ user: UserRow; session: CreatedSession }> {
  assertStrongPassword(input.password);
  const existing = await findUserByEmail(ctx.db, input.email);
  if (existing) {
    throw new AppError('CONFLICT', 'An account with this email already exists. Sign in instead, or reset your password.', {
      details: { fields: { email: ['An account with this email already exists.'] } },
    });
  }
  const passwordHash = await hashPassword(input.password);
  const user = await ctx.db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ name: input.name, email: input.email.toLowerCase(), passwordHash })
      .returning();
    await createWorkspace(tx, { name: input.workspaceName, ownerId: u.id });
    return u;
  });
  await sendVerificationEmail(ctx.db, user);
  const session = await createSession(ctx.db, user.id, { ip: ctx.ip, userAgent: ctx.userAgent });
  await audit(ctx.db, { ...ctx, userId: user.id, userEmail: user.email }, { action: 'auth.sign_up', targetType: 'user', targetId: user.id });
  return { user, session };
}

export async function signIn(
  ctx: ActorContext,
  input: { email: string; password: string },
): Promise<{ user: UserRow; session: CreatedSession; twoFactorRequired: boolean }> {
  const user = await findUserByEmail(ctx.db, input.email);
  if (!user || !user.passwordHash) {
    await dummyPasswordCheck(input.password);
    await audit(ctx.db, { ...ctx, userEmail: input.email }, { action: 'auth.login_failed', metadata: { reason: 'unknown_or_no_password' } });
    throw new AppError('UNAUTHENTICATED', user ? 'This account uses Google sign-in. Continue with Google, or reset your password to add one.' : 'Incorrect email or password.');
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    await audit(ctx.db, { ...ctx, userId: user.id, userEmail: user.email }, { action: 'auth.login_failed', metadata: { reason: 'bad_password' } });
    throw new AppError('UNAUTHENTICATED', 'Incorrect email or password.');
  }
  if (user.disabledAt) throw new AppError('FORBIDDEN', 'This account has been disabled. Contact support for help.');
  const twoFactorRequired = Boolean(user.twoFactorEnabledAt);
  const session = await createSession(ctx.db, user.id, { ip: ctx.ip, userAgent: ctx.userAgent, twoFactorPending: twoFactorRequired });
  if (!twoFactorRequired) await completeLogin(ctx, user);
  return { user, session, twoFactorRequired };
}

async function completeLogin(ctx: ActorContext, user: UserRow) {
  await ctx.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit(ctx.db, { ...ctx, userId: user.id, userEmail: user.email }, { action: 'auth.login', targetType: 'user', targetId: user.id });
}

/** Completes a two-factor sign-in with a TOTP code or a one-time recovery code. */
export async function verifyTwoFactorLogin(ctx: ActorContext, session: SessionRecord, user: UserRow, code: string) {
  if (!session.twoFactorPending) throw badRequest('Two-factor verification is not pending for this session.');
  const normalized = code.replace(/\s|-/g, '');
  let ok = false;
  if (/^\d{6}$/.test(normalized) && user.twoFactorSecretEnc) {
    ok = validateTotp(decryptSecret(user.twoFactorSecretEnc), normalized);
  } else if (normalized.length >= 10) {
    ok = await consumeRecoveryCode(ctx, user.id, normalized);
  }
  if (!ok) throw new AppError('UNAUTHENTICATED', 'That code is not valid. Check your authenticator app and try again.');
  await ctx.db.update(sessions).set({ twoFactorPending: false }).where(eq(sessions.id, session.id));
  await completeLogin(ctx, user);
}

// ---------------------------------------------------------------------------
// Email verification and password reset
// ---------------------------------------------------------------------------

async function issueToken(db: Database, userId: string, email: string, type: 'email_verification' | 'password_reset' | 'email_change', ttl: number) {
  const token = randomToken(32);
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.type, type), isNull(authTokens.usedAt)));
  await db.insert(authTokens).values({ userId, email, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttl) });
  return token;
}

async function consumeToken(db: Database, token: string, type: 'email_verification' | 'password_reset' | 'email_change') {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.type, type), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning();
  return row;
}

export async function sendVerificationEmail(db: Database, user: UserRow) {
  if (user.emailVerifiedAt) return;
  const token = await issueToken(db, user.id, user.email, 'email_verification', EMAIL_TOKEN_TTL_MS);
  await queueSystemMail(verificationEmail(user.email, user.name, token));
}

export async function verifyEmail(ctx: ActorContext, token: string) {
  const row = (await consumeToken(ctx.db, token, 'email_verification')) ?? (await consumeToken(ctx.db, token, 'email_change'));
  if (!row || !row.userId) {
    // Opening the same link twice (for example from two tabs or an email
    // client's link preview) should not look like a failure once verified.
    const [used] = await ctx.db
      .select({ userId: authTokens.userId, email: authTokens.email, verifiedAt: users.emailVerifiedAt, currentEmail: users.email })
      .from(authTokens)
      .innerJoin(users, eq(users.id, authTokens.userId))
      .where(and(eq(authTokens.tokenHash, sha256(token)), sql`${authTokens.usedAt} is not null`, gt(authTokens.expiresAt, new Date())))
      .limit(1);
    if (used?.userId && used.verifiedAt && used.currentEmail.toLowerCase() === used.email.toLowerCase()) {
      return { userId: used.userId, email: used.email };
    }
    throw badRequest('This verification link is invalid or has expired. Request a new one from your account.');
  }
  if (row.type === 'email_change') {
    const clash = await findUserByEmail(ctx.db, row.email);
    if (clash && clash.id !== row.userId) throw new AppError('CONFLICT', 'Another account already uses this email address.');
    await ctx.db.update(users).set({ email: row.email.toLowerCase(), emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
  } else {
    await ctx.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
  }
  await audit(ctx.db, { ...ctx, userId: row.userId }, { action: 'auth.email_verified', targetType: 'user', targetId: row.userId });
  return { userId: row.userId, email: row.email };
}

export async function requestEmailChange(ctx: ActorContext, user: UserRow, newEmail: string, password: string | undefined) {
  if (user.passwordHash && !(await verifyPassword(user.passwordHash, password ?? ''))) {
    throw new AppError('UNAUTHENTICATED', 'Your current password is incorrect.');
  }
  const clash = await findUserByEmail(ctx.db, newEmail);
  if (clash) throw new AppError('CONFLICT', 'Another account already uses this email address.');
  const token = await issueToken(ctx.db, user.id, newEmail.toLowerCase(), 'email_change', EMAIL_TOKEN_TTL_MS);
  await queueSystemMail(emailChangeEmail(newEmail, token));
}

/** Always succeeds from the caller's perspective to avoid revealing which emails exist. */
export async function requestPasswordReset(ctx: ActorContext, email: string) {
  const user = await findUserByEmail(ctx.db, email);
  if (!user || user.disabledAt) return;
  const token = await issueToken(ctx.db, user.id, user.email, 'password_reset', RESET_TOKEN_TTL_MS);
  await queueSystemMail(passwordResetEmail(user.email, token));
  await audit(ctx.db, { ...ctx, userId: user.id, userEmail: user.email }, { action: 'auth.password_reset_requested', targetType: 'user', targetId: user.id });
}

export async function resetPassword(ctx: ActorContext, token: string, newPassword: string) {
  assertStrongPassword(newPassword);
  const row = await consumeToken(ctx.db, token, 'password_reset');
  if (!row || !row.userId) throw badRequest('This reset link is invalid or has expired. Request a new one.');
  const passwordHash = await hashPassword(newPassword);
  // Completing a reset proves control of the inbox, so the address is verified.
  await ctx.db.update(users).set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, row.userId));
  await revokeOtherSessions(ctx.db, row.userId, null);
  await audit(ctx.db, { ...ctx, userId: row.userId }, { action: 'auth.password_reset', targetType: 'user', targetId: row.userId });
}

export async function changePassword(ctx: ActorContext, user: UserRow, currentSessionId: string, current: string | undefined, next: string) {
  if (user.passwordHash) {
    if (!current || !(await verifyPassword(user.passwordHash, current))) {
      throw new AppError('UNAUTHENTICATED', 'Your current password is incorrect.', {
        details: { fields: { currentPassword: ['Your current password is incorrect.'] } },
      });
    }
  }
  assertStrongPassword(next);
  await ctx.db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, user.id));
  const revoked = await revokeOtherSessions(ctx.db, user.id, currentSessionId);
  await audit(ctx.db, ctx, { action: 'auth.password_changed', targetType: 'user', targetId: user.id, metadata: { otherSessionsRevoked: revoked } });
  return { otherSessionsRevoked: revoked };
}

// ---------------------------------------------------------------------------
// Two-factor authentication (TOTP) and recovery codes
// ---------------------------------------------------------------------------

function totpFor(secretBase32: string, label = 'Localy') {
  return new OTPAuth.TOTP({ issuer: 'Localy', label, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secretBase32) });
}

export function validateTotp(secretBase32: string, token: string): boolean {
  return totpFor(secretBase32).validate({ token, window: 1 }) !== null;
}

export async function beginTwoFactorSetup(db: Database, user: UserRow) {
  if (user.twoFactorEnabledAt) throw badRequest('Two-factor authentication is already enabled.');
  const secret = new OTPAuth.Secret({ size: 20 });
  await db.update(users).set({ twoFactorSecretEnc: encryptSecret(secret.base32) }).where(eq(users.id, user.id));
  const uri = totpFor(secret.base32, user.email).toString();
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: '#111111', light: '#ffffff' } });
  return { secret: secret.base32, uri, qrDataUrl };
}

function generateRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const raw = randomToken(8).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().padEnd(10, '0').slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export async function confirmTwoFactorSetup(ctx: ActorContext, user: UserRow, code: string) {
  if (!user.twoFactorSecretEnc) throw badRequest('Start two-factor setup first.');
  if (!validateTotp(decryptSecret(user.twoFactorSecretEnc), code.replace(/\s/g, ''))) {
    throw new AppError('VALIDATION_ERROR', 'That code is not valid. Check the time on your device and try again.');
  }
  const codes = generateRecoveryCodes();
  await ctx.db.transaction(async (tx) => {
    await tx.update(users).set({ twoFactorEnabledAt: new Date() }).where(eq(users.id, user.id));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId: user.id, codeHash: sha256(c.replace('-', '')) })));
  });
  await audit(ctx.db, ctx, { action: 'auth.two_factor_enabled', targetType: 'user', targetId: user.id });
  return { recoveryCodes: codes };
}

export async function regenerateRecoveryCodes(ctx: ActorContext, user: UserRow, password: string | undefined) {
  if (user.passwordHash && !(await verifyPassword(user.passwordHash, password ?? ''))) throw new AppError('UNAUTHENTICATED', 'Your password is incorrect.');
  if (!user.twoFactorEnabledAt) throw badRequest('Enable two-factor authentication first.');
  const codes = generateRecoveryCodes();
  await ctx.db.transaction(async (tx) => {
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId: user.id, codeHash: sha256(c.replace('-', '')) })));
  });
  return { recoveryCodes: codes };
}

export async function disableTwoFactor(ctx: ActorContext, user: UserRow, password: string | undefined, code: string | undefined) {
  if (user.passwordHash) {
    if (!(await verifyPassword(user.passwordHash, password ?? ''))) throw new AppError('UNAUTHENTICATED', 'Your password is incorrect.');
  } else if (!user.twoFactorSecretEnc || !code || !validateTotp(decryptSecret(user.twoFactorSecretEnc), code)) {
    throw new AppError('UNAUTHENTICATED', 'Enter a valid authentication code.');
  }
  await ctx.db.update(users).set({ twoFactorEnabledAt: null, twoFactorSecretEnc: null }).where(eq(users.id, user.id));
  await ctx.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
  await audit(ctx.db, ctx, { action: 'auth.two_factor_disabled', targetType: 'user', targetId: user.id });
}

async function consumeRecoveryCode(ctx: ActorContext, userId: string, code: string): Promise<boolean> {
  const [row] = await ctx.db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, sha256(code.toLowerCase())), isNull(recoveryCodes.usedAt)))
    .returning({ id: recoveryCodes.id });
  if (row) await audit(ctx.db, { ...ctx, userId }, { action: 'auth.recovery_code_used', targetType: 'user', targetId: userId });
  return Boolean(row);
}

export async function remainingRecoveryCodes(db: Database, userId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return r?.n ?? 0;
}

// ---------------------------------------------------------------------------
// OAuth sign-in (Google)
// ---------------------------------------------------------------------------

export async function signInWithOAuth(
  ctx: ActorContext,
  profile: { provider: 'google' | 'microsoft'; providerAccountId: string; email: string; emailVerified: boolean; name: string; avatarUrl?: string | null },
): Promise<{ user: UserRow; session: CreatedSession; created: boolean; twoFactorRequired: boolean }> {
  const [linked] = await ctx.db
    .select({ user: users })
    .from(oauthAccounts)
    .innerJoin(users, eq(users.id, oauthAccounts.userId))
    .where(and(eq(oauthAccounts.provider, profile.provider), eq(oauthAccounts.providerAccountId, profile.providerAccountId)))
    .limit(1);
  let user = linked?.user;
  let created = false;
  if (!user) {
    const byEmail = await findUserByEmail(ctx.db, profile.email);
    if (byEmail) {
      // Only auto-link when the provider asserts the email is verified.
      if (!profile.emailVerified) throw new AppError('CONFLICT', 'An account with this email already exists. Sign in with your password.');
      user = byEmail;
    } else {
      user = await ctx.db.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({
            name: profile.name || profile.email.split('@')[0],
            email: profile.email.toLowerCase(),
            emailVerifiedAt: profile.emailVerified ? new Date() : null,
            avatarUrl: profile.avatarUrl ?? null,
          })
          .returning();
        await createWorkspace(tx, { name: `${u.name.split(' ')[0]}'s workspace`, ownerId: u.id });
        return u;
      });
      created = true;
      await audit(ctx.db, { ...ctx, userId: user.id, userEmail: user.email }, { action: 'auth.sign_up', targetType: 'user', targetId: user.id, metadata: { via: profile.provider } });
    }
    await ctx.db
      .insert(oauthAccounts)
      .values({ userId: user.id, provider: profile.provider, providerAccountId: profile.providerAccountId, email: profile.email })
      .onConflictDoNothing();
    await audit(ctx.db, { ...ctx, userId: user.id, userEmail: user.email }, { action: 'auth.oauth_linked', metadata: { provider: profile.provider } });
    if (profile.emailVerified && !user.emailVerifiedAt) {
      await ctx.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
    }
  }
  if (user.disabledAt) throw new AppError('FORBIDDEN', 'This account has been disabled.');
  const twoFactorRequired = Boolean(user.twoFactorEnabledAt);
  const session = await createSession(ctx.db, user.id, { ip: ctx.ip, userAgent: ctx.userAgent, twoFactorPending: twoFactorRequired });
  if (!twoFactorRequired) await completeLogin(ctx, user);
  return { user, session, created, twoFactorRequired };
}
