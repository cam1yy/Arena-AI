import type { Role } from '@localy/shared';
import type { Database } from '@localy/database';

/** Identifies who is acting and in which workspace. Passed to every service. */
export interface ActorContext {
  db: Database;
  userId: string | null;
  userEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface WorkspaceContext extends ActorContext {
  workspaceId: string;
  role: Role;
  /** Set when the request is authenticated with an API key instead of a session. */
  apiKeyId?: string | null;
}
