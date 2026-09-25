import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { campaigns, emailTemplates, notes, prospects } from '@localy/database';
import type { WorkspaceContext } from '../context';

/** Global search across user-created data (Google content is not indexed). */
export async function globalSearch(ctx: WorkspaceContext, q: string) {
  const query = q.trim();
  if (query.length < 2) return { prospects: [], campaigns: [], templates: [], notes: [] };
  const term = `%${query.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const [p, c, t, n] = await Promise.all([
    ctx.db
      .select({ id: prospects.id, name: prospects.name, placeId: prospects.placeId, email: prospects.email, status: prospects.status, locationLabel: prospects.locationLabel, categoryLabel: prospects.categoryLabel })
      .from(prospects)
      .where(and(eq(prospects.workspaceId, ctx.workspaceId), or(ilike(prospects.name, term), ilike(prospects.email, term), ilike(prospects.contactFirstName, term), ilike(prospects.contactLastName, term), ilike(prospects.locationLabel, term), ilike(prospects.phone, term))))
      .orderBy(desc(prospects.updatedAt))
      .limit(8),
    ctx.db
      .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, ctx.workspaceId), ilike(campaigns.name, term)))
      .orderBy(desc(campaigns.updatedAt))
      .limit(6),
    ctx.db
      .select({ id: emailTemplates.id, name: emailTemplates.name, subject: emailTemplates.subject, kind: emailTemplates.kind })
      .from(emailTemplates)
      .where(and(eq(emailTemplates.workspaceId, ctx.workspaceId), or(ilike(emailTemplates.name, term), ilike(emailTemplates.subject, term), ilike(emailTemplates.body, term))))
      .orderBy(desc(emailTemplates.updatedAt))
      .limit(6),
    ctx.db
      .select({ id: notes.id, body: notes.body, prospectId: notes.prospectId, prospectName: prospects.name, placeId: prospects.placeId, createdAt: notes.createdAt })
      .from(notes)
      .innerJoin(prospects, eq(prospects.id, notes.prospectId))
      .where(and(eq(notes.workspaceId, ctx.workspaceId), ilike(notes.body, term)))
      .orderBy(desc(notes.createdAt))
      .limit(6),
  ]);
  return {
    prospects: p,
    campaigns: c,
    templates: t,
    notes: n.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })),
  };
}
