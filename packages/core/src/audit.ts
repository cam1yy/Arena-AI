import { auditLogs, type DbOrTx } from '@localy/database';
import type { ActorContext } from './context';
import { logger } from './logger';

export type AuditAction =
  | 'auth.sign_up'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.session_revoked'
  | 'auth.password_changed'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.email_verified'
  | 'auth.two_factor_enabled'
  | 'auth.two_factor_disabled'
  | 'auth.recovery_code_used'
  | 'auth.oauth_linked'
  | 'admin.elevated'
  | 'admin.user_disabled'
  | 'admin.user_enabled'
  | 'admin.subscription_updated'
  | 'admin.campaign_paused'
  | 'admin.settings_updated'
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.deleted'
  | 'workspace.ownership_transferred'
  | 'member.invited'
  | 'member.invitation_revoked'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.removed'
  | 'settings.profile_updated'
  | 'settings.notifications_updated'
  | 'campaign.created'
  | 'campaign.updated'
  | 'campaign.deleted'
  | 'campaign.started'
  | 'campaign.scheduled'
  | 'campaign.paused'
  | 'campaign.resumed'
  | 'campaign.completed'
  | 'email.sent'
  | 'email.test_sent'
  | 'email.reply_sent'
  | 'integration.connected'
  | 'integration.disconnected'
  | 'integration.updated'
  | 'billing.checkout_started'
  | 'billing.plan_changed'
  | 'billing.canceled'
  | 'billing.resumed'
  | 'billing.subscription_synced'
  | 'apikey.created'
  | 'apikey.revoked'
  | 'data.exported'
  | 'prospects.deleted'
  | 'account.deleted';

export interface AuditEntry {
  action: AuditAction;
  workspaceId?: string | null;
  targetType?: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Writes an audit record. Failures are logged and never break the calling operation. */
export async function audit(db: DbOrTx, actor: Partial<ActorContext> | null, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      workspaceId: entry.workspaceId ?? null,
      userId: actor?.userId ?? null,
      actorEmail: actor?.userEmail ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ip: actor?.ip ?? null,
      userAgent: actor?.userAgent?.slice(0, 300) ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'failed to write audit log');
  }
}
