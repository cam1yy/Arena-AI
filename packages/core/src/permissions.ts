import type { Role } from '@localy/shared';
import { forbidden } from './errors';
import type { WorkspaceContext } from './context';

/**
 * Server-side permission matrix for workspace roles. Platform administration
 * is entirely separate (users.is_platform_admin) and never granted by a
 * workspace role.
 */
export const PERMISSIONS = {
  'workspace.read': ['owner', 'admin', 'member'],
  'workspace.update': ['owner', 'admin'],
  'workspace.delete': ['owner'],
  'workspace.transfer': ['owner'],
  'members.read': ['owner', 'admin', 'member'],
  'members.manage': ['owner', 'admin'],
  'billing.read': ['owner', 'admin', 'member'],
  'billing.manage': ['owner', 'admin'],
  'integrations.read': ['owner', 'admin', 'member'],
  'integrations.connect': ['owner', 'admin', 'member'],
  'integrations.manage_all': ['owner', 'admin'],
  'apikeys.manage': ['owner', 'admin'],
  'audit.read': ['owner', 'admin'],
  'data.export': ['owner', 'admin'],
  'prospects.write': ['owner', 'admin', 'member'],
  'prospects.delete': ['owner', 'admin', 'member'],
  'campaigns.write': ['owner', 'admin', 'member'],
  'templates.write': ['owner', 'admin', 'member'],
  'discovery.run': ['owner', 'admin', 'member'],
  'inbox.write': ['owner', 'admin', 'member'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function assertCan(ctx: Pick<WorkspaceContext, 'role'>, permission: Permission, message?: string): void {
  if (!can(ctx.role, permission)) throw forbidden(message);
}
