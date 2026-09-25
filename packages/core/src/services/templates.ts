import { and, desc, eq, sql } from 'drizzle-orm';
import { campaignSteps, emailTemplates } from '@localy/database';
import type { TemplateItem } from '@localy/shared';
import { notFound } from '../errors';
import type { WorkspaceContext } from '../context';
import { assertCan } from '../permissions';

type TemplateRow = typeof emailTemplates.$inferSelect;

function toItem(t: TemplateRow, usageCount = 0): TemplateItem {
  return {
    id: t.id,
    name: t.name,
    subject: t.subject,
    body: t.body,
    kind: t.kind,
    defaultDelayDays: t.defaultDelayDays,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    usageCount,
  };
}

export async function listTemplates(ctx: WorkspaceContext): Promise<TemplateItem[]> {
  const rows = await ctx.db
    .select({ t: emailTemplates, usage: sql<number>`(select count(*)::int from ${campaignSteps} where ${campaignSteps.templateId} = ${emailTemplates.id})` })
    .from(emailTemplates)
    .where(eq(emailTemplates.workspaceId, ctx.workspaceId))
    .orderBy(emailTemplates.kind, desc(emailTemplates.updatedAt));
  return rows.map((r) => toItem(r.t, r.usage));
}

export async function getTemplate(ctx: WorkspaceContext, id: string): Promise<TemplateItem> {
  const [t] = await ctx.db.select().from(emailTemplates).where(and(eq(emailTemplates.id, id), eq(emailTemplates.workspaceId, ctx.workspaceId))).limit(1);
  if (!t) throw notFound('Template');
  return toItem(t);
}

export async function createTemplate(ctx: WorkspaceContext, input: { name: string; subject: string; body: string; kind: 'initial' | 'follow_up'; defaultDelayDays: number }) {
  assertCan(ctx, 'templates.write');
  const [t] = await ctx.db.insert(emailTemplates).values({ ...input, workspaceId: ctx.workspaceId, createdBy: ctx.userId }).returning();
  return toItem(t);
}

export async function updateTemplate(ctx: WorkspaceContext, id: string, input: { name: string; subject: string; body: string; kind: 'initial' | 'follow_up'; defaultDelayDays: number }) {
  assertCan(ctx, 'templates.write');
  const [t] = await ctx.db
    .update(emailTemplates)
    .set(input)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.workspaceId, ctx.workspaceId)))
    .returning();
  if (!t) throw notFound('Template');
  return toItem(t);
}

export async function duplicateTemplate(ctx: WorkspaceContext, id: string) {
  const t = await getTemplate(ctx, id);
  return createTemplate(ctx, { name: `${t.name} (copy)`, subject: t.subject, body: t.body, kind: t.kind, defaultDelayDays: t.defaultDelayDays });
}

export async function deleteTemplate(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, 'templates.write');
  const res = await ctx.db
    .delete(emailTemplates)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.workspaceId, ctx.workspaceId)))
    .returning({ id: emailTemplates.id });
  if (!res.length) throw notFound('Template');
}
