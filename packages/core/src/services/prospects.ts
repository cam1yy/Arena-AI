import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  campaignRecipients,
  campaigns,
  discoveredPlaces,
  emailMessages,
  followUps,
  notes,
  prospectTags,
  prospects,
  tags,
  users,
  type DbOrTx,
} from '@localy/database';
import {
  computeSignals,
  countPositiveSignals,
  PROSPECT_STATUS_LABELS,
  SIGNAL_KEYS,
  type Paginated,
  type PlaceResult,
  type ProspectListItem,
  type ProspectStatus,
  type SignalKey,
  type Signals,
  type WebsiteStatus,
} from '@localy/shared';
import { AppError, badRequest, notFound } from '../errors';
import type { WorkspaceContext } from '../context';
import { assertCan } from '../permissions';
import { audit } from '../audit';
import { analyzePlace, getPlaceDetails, getPlaceSummaries, googleMapsUrlForPlaceId } from '../google/places';
import { assertWithinLimit, getEffectivePlan, getUsageItem } from './usage';
import { listActivity, recordActivities, recordActivity } from './activity';
import { mapWithConcurrency } from '../http';

type ProspectRow = typeof prospects.$inferSelect;

export async function getProspectOrThrow(db: DbOrTx, workspaceId: string, id: string): Promise<ProspectRow> {
  const [p] = await db.select().from(prospects).where(and(eq(prospects.id, id), eq(prospects.workspaceId, workspaceId))).limit(1);
  if (!p) throw notFound('Prospect');
  return p;
}

export function prospectDisplayName(p: Pick<ProspectRow, 'name'>, live?: PlaceResult | null) {
  return p.name || live?.name || 'Unnamed business';
}

function toListItem(p: ProspectRow, tagList: { id: string; name: string }[], live: PlaceResult | null, liveError: string | null, nextFollowUpAt: Date | null): ProspectListItem {
  const contact = [p.contactFirstName, p.contactLastName].filter(Boolean).join(' ') || null;
  return {
    id: p.id,
    placeId: p.placeId,
    source: p.source,
    status: p.status,
    name: p.name,
    displayName: prospectDisplayName(p, live),
    contactName: contact,
    email: p.email,
    phone: p.phone,
    locationLabel: p.locationLabel,
    categoryLabel: p.categoryLabel,
    websiteStatus: p.websiteStatus,
    socialProfileOnly: p.socialProfileOnly,
    signals: p.signals,
    tags: tagList,
    lastContactedAt: p.lastContactedAt?.toISOString() ?? null,
    nextFollowUpAt: nextFollowUpAt?.toISOString() ?? null,
    unsubscribed: Boolean(p.unsubscribedAt),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    live,
    liveError,
  };
}

async function tagsFor(db: DbOrTx, prospectIds: string[]) {
  const map = new Map<string, { id: string; name: string }[]>();
  if (!prospectIds.length) return map;
  const rows = await db
    .select({ prospectId: prospectTags.prospectId, id: tags.id, name: tags.name })
    .from(prospectTags)
    .innerJoin(tags, eq(tags.id, prospectTags.tagId))
    .where(inArray(prospectTags.prospectId, prospectIds))
    .orderBy(tags.name);
  for (const r of rows) {
    const list = map.get(r.prospectId) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.prospectId, list);
  }
  return map;
}

async function nextFollowUps(db: DbOrTx, prospectIds: string[]) {
  const map = new Map<string, Date>();
  if (!prospectIds.length) return map;
  const reminders = await db
    .select({ prospectId: followUps.prospectId, dueAt: sql<Date>`min(${followUps.dueAt})` })
    .from(followUps)
    .where(and(inArray(followUps.prospectId, prospectIds), eq(followUps.status, 'scheduled')))
    .groupBy(followUps.prospectId);
  const seq = await db
    .select({ prospectId: campaignRecipients.prospectId, dueAt: sql<Date>`min(${campaignRecipients.nextSendAt})` })
    .from(campaignRecipients)
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(and(inArray(campaignRecipients.prospectId, prospectIds), eq(campaignRecipients.status, 'in_progress'), eq(campaigns.status, 'active')))
    .groupBy(campaignRecipients.prospectId);
  for (const r of [...reminders, ...seq]) {
    if (!r.dueAt) continue;
    const d = new Date(r.dueAt);
    const cur = map.get(r.prospectId);
    if (!cur || d < cur) map.set(r.prospectId, d);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Saves businesses from a discovery search. Localy re-fetches each place live
 * to classify it, stores the place ID and Localy's own analysis (website
 * status and signals), and does not persist Google-provided content.
 */
export async function saveFromDiscovery(
  ctx: WorkspaceContext,
  input: {
    searchId?: string | null;
    businesses: { placeId: string; websiteStatus?: WebsiteStatus; socialProfileOnly?: boolean; signals?: Signals }[];
    tagIds?: string[];
  },
) {
  assertCan(ctx, 'prospects.write');
  const byPlace = new Map(input.businesses.map((b) => [b.placeId, b]));
  const placeIds = [...byPlace.keys()];
  const existing = await ctx.db
    .select({ id: prospects.id, placeId: prospects.placeId })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, ctx.workspaceId), inArray(prospects.placeId, placeIds)));
  const existingIds = new Set(existing.map((e) => e.placeId));
  const toCreate = placeIds.filter((id) => !existingIds.has(id));
  if (!toCreate.length) return { created: [], alreadySaved: existing.map((e) => ({ id: e.id, placeId: e.placeId! })) };
  await assertWithinLimit(ctx.db, ctx.workspaceId, 'prospects', toCreate.length);

  // Businesses that came from this workspace's discovery results reuse the
  // analysis computed during the search (no extra Google request). Anything
  // else is verified with a live Place Details lookup.
  const discovered = await ctx.db
    .select({ placeId: discoveredPlaces.placeId })
    .from(discoveredPlaces)
    .where(and(eq(discoveredPlaces.workspaceId, ctx.workspaceId), inArray(discoveredPlaces.placeId, toCreate)));
  const discoveredSet = new Set(discovered.map((d) => d.placeId));

  const analyses = await mapWithConcurrency(toCreate, 6, async (placeId) => {
    const given = byPlace.get(placeId);
    if (discoveredSet.has(placeId) && given?.websiteStatus) {
      const signals = { ...(given.signals ?? {}) };
      return { placeId, websiteStatus: given.websiteStatus, socialProfileOnly: Boolean(given.socialProfileOnly), signals, analyzed: true };
    }
    try {
      const place = await getPlaceDetails(placeId, { workspaceId: ctx.workspaceId });
      const a = analyzePlace(place, null);
      return { placeId, websiteStatus: a.websiteStatus, socialProfileOnly: a.socialProfileOnly, signals: a.signals, analyzed: true };
    } catch (err) {
      if (err instanceof AppError && err.code === 'NOT_FOUND') return null;
      return { placeId, websiteStatus: 'unknown' as WebsiteStatus, socialProfileOnly: false, signals: {} as Signals, analyzed: false };
    }
  });

  const rows = analyses
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => ({
      workspaceId: ctx.workspaceId,
      placeId: a.placeId,
      source: 'google_places' as const,
      websiteStatus: a.websiteStatus,
      socialProfileOnly: a.socialProfileOnly,
      signals: a.signals,
      signalCount: countPositiveSignals(a.signals),
      analysisUpdatedAt: a.analyzed ? new Date() : null,
      discoveredSearchId: input.searchId ?? null,
      createdBy: ctx.userId,
    }));
  if (!rows.length) throw notFound('Business');

  const created = await ctx.db.transaction(async (tx) => {
    const inserted = await tx.insert(prospects).values(rows).onConflictDoNothing().returning({ id: prospects.id, placeId: prospects.placeId });
    if (input.tagIds?.length && inserted.length) {
      const validTags = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.workspaceId, ctx.workspaceId), inArray(tags.id, input.tagIds)));
      if (validTags.length) {
        await tx.insert(prospectTags).values(inserted.flatMap((p) => validTags.map((t) => ({ prospectId: p.id, tagId: t.id })))).onConflictDoNothing();
      }
    }
    await recordActivities(
      tx,
      inserted.flatMap((p) => [
        { workspaceId: ctx.workspaceId, prospectId: p.id, actorId: ctx.userId, type: 'business_discovered' as const, data: { searchId: input.searchId ?? null } },
        { workspaceId: ctx.workspaceId, prospectId: p.id, actorId: ctx.userId, type: 'prospect_created' as const, data: { source: 'google_places' } },
      ]),
    );
    return inserted;
  });
  return {
    created: created.map((c) => ({ id: c.id, placeId: c.placeId! })),
    alreadySaved: existing.map((e) => ({ id: e.id, placeId: e.placeId! })),
  };
}

export async function createManualProspect(
  ctx: WorkspaceContext,
  input: {
    name: string;
    contactFirstName?: string | null;
    contactLastName?: string | null;
    email?: string | null;
    phone?: string | null;
    locationLabel?: string | null;
    categoryLabel?: string | null;
    websiteUrl?: string | null;
    status?: ProspectStatus;
    tagIds?: string[];
    note?: string;
  },
) {
  assertCan(ctx, 'prospects.write');
  await assertWithinLimit(ctx.db, ctx.workspaceId, 'prospects', 1);
  const websiteStatus: WebsiteStatus = input.websiteUrl ? 'listed' : 'unknown';
  const signals = computeSignals({ websiteStatus, hasPhone: Boolean(input.phone), hasEmail: Boolean(input.email) });
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx
      .insert(prospects)
      .values({
        workspaceId: ctx.workspaceId,
        source: 'manual',
        status: input.status ?? 'new',
        name: input.name,
        contactFirstName: input.contactFirstName ?? null,
        contactLastName: input.contactLastName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        locationLabel: input.locationLabel ?? null,
        categoryLabel: input.categoryLabel ?? null,
        websiteUrl: input.websiteUrl ?? null,
        websiteStatus,
        signals,
        signalCount: countPositiveSignals(signals),
        analysisUpdatedAt: new Date(),
        createdBy: ctx.userId,
      })
      .returning();
    if (input.tagIds?.length) {
      const valid = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.workspaceId, ctx.workspaceId), inArray(tags.id, input.tagIds)));
      if (valid.length) await tx.insert(prospectTags).values(valid.map((t) => ({ prospectId: p.id, tagId: t.id })));
    }
    if (input.note?.trim()) {
      await tx.insert(notes).values({ workspaceId: ctx.workspaceId, prospectId: p.id, authorId: ctx.userId, body: input.note.trim() });
    }
    await recordActivity(tx, { workspaceId: ctx.workspaceId, prospectId: p.id, actorId: ctx.userId, type: 'prospect_created', data: { source: 'manual' } });
    return p;
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface ProspectListQuery {
  q?: string;
  ids?: string[];
  status?: ProspectStatus | 'active' | 'all';
  tagId?: string;
  website?: WebsiteStatus | 'any' | 'opportunity';
  hasEmail?: 'any' | 'yes' | 'no';
  campaignId?: string;
  signal?: SignalKey;
  sort?: string;
  page: number;
  pageSize: number;
}

function listConditions(ctx: WorkspaceContext, q: ProspectListQuery): SQL[] {
  const conds: SQL[] = [eq(prospects.workspaceId, ctx.workspaceId)];
  if (q.ids) {
    // Explicit ID lists (for example composer recipients) ignore the default status filter.
    conds.push(q.ids.length ? inArray(prospects.id, q.ids) : sql`false`);
  } else if (!q.status || q.status === 'active') conds.push(ne(prospects.status, 'archived'));
  else if (q.status !== 'all') conds.push(eq(prospects.status, q.status));
  if (q.q) {
    const term = `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(
      or(
        ilike(prospects.name, term),
        ilike(prospects.email, term),
        ilike(prospects.locationLabel, term),
        ilike(prospects.categoryLabel, term),
        ilike(prospects.contactFirstName, term),
        ilike(prospects.contactLastName, term),
        ilike(prospects.phone, term),
      )!,
    );
  }
  if (q.tagId) conds.push(sql`exists (select 1 from ${prospectTags} where ${prospectTags.prospectId} = ${prospects.id} and ${prospectTags.tagId} = ${q.tagId})`);
  if (q.website && q.website !== 'any') {
    if (q.website === 'opportunity') conds.push(or(inArray(prospects.websiteStatus, ['not_listed', 'unavailable']), eq(prospects.socialProfileOnly, true))!);
    else conds.push(eq(prospects.websiteStatus, q.website));
  }
  if (q.hasEmail === 'yes') conds.push(sql`coalesce(${prospects.email}, '') <> ''`);
  if (q.hasEmail === 'no') conds.push(sql`coalesce(${prospects.email}, '') = ''`);
  if (q.campaignId) conds.push(sql`exists (select 1 from ${campaignRecipients} where ${campaignRecipients.prospectId} = ${prospects.id} and ${campaignRecipients.campaignId} = ${q.campaignId})`);
  if (q.signal && (SIGNAL_KEYS as readonly string[]).includes(q.signal)) conds.push(sql`(${prospects.signals} ->> ${q.signal})::boolean is true`);
  return conds;
}

function listOrder(sort: string | undefined) {
  if (sort && (SIGNAL_KEYS as readonly string[]).includes(sort)) {
    return [sql`coalesce((${prospects.signals} ->> ${sort})::boolean, false) desc`, desc(prospects.signalCount), desc(prospects.createdAt)];
  }
  switch (sort) {
    case 'created_asc':
      return [asc(prospects.createdAt)];
    case 'name_asc':
      return [sql`lower(coalesce(${prospects.name}, '')) asc`, desc(prospects.createdAt)];
    case 'updated_desc':
      return [desc(prospects.updatedAt)];
    case 'last_contacted_desc':
      return [sql`${prospects.lastContactedAt} desc nulls last`, desc(prospects.createdAt)];
    case 'signals_desc':
      return [desc(prospects.signalCount), desc(prospects.createdAt)];
    default:
      return [desc(prospects.createdAt)];
  }
}

/**
 * Lists prospects with pagination. Names, addresses and categories for
 * Google-sourced prospects are fetched live for the current page only.
 */
export async function listProspects(ctx: WorkspaceContext, q: ProspectListQuery, opts: { live?: boolean } = {}): Promise<Paginated<ProspectListItem>> {
  const conds = listConditions(ctx, q);
  const where = and(...conds);
  const [{ total }] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(prospects).where(where);
  const rows = await ctx.db
    .select()
    .from(prospects)
    .where(where)
    .orderBy(...listOrder(q.sort))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const ids = rows.map((r) => r.id);
  const [tagMap, followMap] = await Promise.all([tagsFor(ctx.db, ids), nextFollowUps(ctx.db, ids)]);
  const liveMap = new Map<string, { place: PlaceResult | null; error: string | null }>();
  if (opts.live === true) {
    const needLive = rows.filter((r) => r.placeId).map((r) => r.placeId!);
    if (needLive.length) {
      try {
        const results = await getPlaceSummaries(needLive, ctx.workspaceId);
        for (const r of results) liveMap.set(r.placeId, { place: r.place, error: r.error });
      } catch (err) {
        for (const id of needLive) liveMap.set(id, { place: null, error: (err as Error).message });
      }
    }
  }
  return {
    items: rows.map((r) => {
      const live = r.placeId ? liveMap.get(r.placeId) : undefined;
      return toListItem(r, tagMap.get(r.id) ?? [], live?.place ?? null, live?.error ?? null, followMap.get(r.id) ?? null);
    }),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function listProspectIds(ctx: WorkspaceContext, q: Omit<ProspectListQuery, 'page' | 'pageSize'>) {
  const rows = await ctx.db
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(...listConditions(ctx, { ...q, page: 1, pageSize: 1 })))
    .limit(5000);
  return rows.map((r) => r.id);
}

export async function getProspectDetail(ctx: WorkspaceContext, id: string) {
  const p = await getProspectOrThrow(ctx.db, ctx.workspaceId, id);
  let live: PlaceResult | null = null;
  let liveError: string | null = null;
  if (p.placeId) {
    try {
      live = await getPlaceDetails(p.placeId, { workspaceId: ctx.workspaceId });
      // Refresh Localy's own analysis snapshot from the live listing.
      const analysis = analyzePlace(live, null);
      const signals = { ...analysis.signals, hasEmail: Boolean(p.email) };
      const keepVerification = p.websiteStatus === 'detected' || p.websiteStatus === 'unavailable';
      const websiteStatus = keepVerification && analysis.websiteStatus === 'listed' ? p.websiteStatus : analysis.websiteStatus;
      if (keepVerification && websiteStatus === 'unavailable') signals.websiteUnavailable = true;
      await ctx.db
        .update(prospects)
        .set({ websiteStatus, socialProfileOnly: analysis.socialProfileOnly, signals, signalCount: countPositiveSignals(signals), analysisUpdatedAt: new Date() })
        .where(eq(prospects.id, p.id));
      Object.assign(p, { websiteStatus, socialProfileOnly: analysis.socialProfileOnly, signals });
    } catch (err) {
      liveError = err instanceof AppError ? err.message : 'Live business details are temporarily unavailable.';
    }
  }
  const [tagMap, followMap] = await Promise.all([tagsFor(ctx.db, [p.id]), nextFollowUps(ctx.db, [p.id])]);
  const [noteRows, activity, campaignRows, messages, reminders] = await Promise.all([
    ctx.db
      .select({ id: notes.id, body: notes.body, createdAt: notes.createdAt, updatedAt: notes.updatedAt, authorId: notes.authorId, authorName: users.name })
      .from(notes)
      .leftJoin(users, eq(users.id, notes.authorId))
      .where(and(eq(notes.prospectId, p.id), eq(notes.workspaceId, ctx.workspaceId)))
      .orderBy(desc(notes.createdAt)),
    listActivity(ctx, { prospectId: p.id, limit: 100 }),
    ctx.db
      .select({
        recipientId: campaignRecipients.id,
        campaignId: campaigns.id,
        name: campaigns.name,
        campaignStatus: campaigns.status,
        status: campaignRecipients.status,
        currentStep: campaignRecipients.currentStep,
        nextSendAt: campaignRecipients.nextSendAt,
        addedAt: campaignRecipients.createdAt,
        kind: campaigns.kind,
      })
      .from(campaignRecipients)
      .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
      .where(and(eq(campaignRecipients.prospectId, p.id), eq(campaignRecipients.workspaceId, ctx.workspaceId)))
      .orderBy(desc(campaignRecipients.createdAt)),
    ctx.db
      .select()
      .from(emailMessages)
      .where(and(eq(emailMessages.prospectId, p.id), eq(emailMessages.workspaceId, ctx.workspaceId), eq(emailMessages.isTest, false)))
      .orderBy(desc(emailMessages.createdAt))
      .limit(100),
    ctx.db
      .select()
      .from(followUps)
      .where(and(eq(followUps.prospectId, p.id), eq(followUps.workspaceId, ctx.workspaceId)))
      .orderBy(asc(followUps.dueAt)),
  ]);
  return {
    prospect: toListItem(p, tagMap.get(p.id) ?? [], live, liveError, followMap.get(p.id) ?? null),
    googleMapsUrl: live?.googleMapsUri ?? (p.placeId ? googleMapsUrlForPlaceId(p.placeId) : null),
    websiteCheck: p.websiteCheckedAt ? { checkedAt: p.websiteCheckedAt.toISOString(), httpStatus: p.websiteHttpStatus } : null,
    websiteUrl: p.websiteUrl,
    discovery: { source: p.source, searchId: p.discoveredSearchId, createdAt: p.createdAt.toISOString(), analysisUpdatedAt: p.analysisUpdatedAt?.toISOString() ?? null },
    notes: noteRows.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString(), author: n.authorId ? { id: n.authorId, name: n.authorName ?? 'Former member' } : null })),
    activity,
    campaigns: campaignRows.map((c) => ({ ...c, nextSendAt: c.nextSendAt?.toISOString() ?? null, addedAt: c.addedAt.toISOString() })),
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      status: m.status,
      subject: m.subject,
      toEmail: m.toEmail,
      fromEmail: m.fromEmail,
      bodyText: m.bodyText,
      sentAt: m.sentAt?.toISOString() ?? null,
      receivedAt: m.receivedAt?.toISOString() ?? null,
      scheduledFor: m.scheduledFor?.toISOString() ?? null,
      error: m.error,
      threadId: m.threadId,
      campaignId: m.campaignId,
      stepPosition: m.stepPosition,
      createdAt: m.createdAt.toISOString(),
    })),
    followUps: reminders.map((f) => ({ id: f.id, dueAt: f.dueAt.toISOString(), note: f.note, status: f.status, completedAt: f.completedAt?.toISOString() ?? null })),
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateProspect(
  ctx: WorkspaceContext,
  id: string,
  patch: {
    name?: string | null;
    contactFirstName?: string | null;
    contactLastName?: string | null;
    email?: string | null;
    phone?: string | null;
    locationLabel?: string | null;
    categoryLabel?: string | null;
    websiteUrl?: string | null;
    status?: ProspectStatus;
  },
) {
  assertCan(ctx, 'prospects.write');
  const p = await getProspectOrThrow(ctx.db, ctx.workspaceId, id);
  const { status, ...fields } = patch;
  const contactFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const update: Partial<ProspectRow> = { ...contactFields };
  if ('email' in contactFields || 'phone' in contactFields) {
    const signals = { ...p.signals };
    if ('email' in contactFields) signals.hasEmail = Boolean(contactFields.email);
    if ('phone' in contactFields && p.source !== 'google_places') signals.hasPhone = Boolean(contactFields.phone);
    update.signals = signals;
    update.signalCount = countPositiveSignals(signals);
  }
  if (p.source !== 'google_places' && 'websiteUrl' in contactFields) {
    update.websiteStatus = contactFields.websiteUrl ? 'listed' : 'unknown';
  }
  await ctx.db.transaction(async (tx) => {
    if (Object.keys(update).length) await tx.update(prospects).set(update).where(eq(prospects.id, id));
    if (Object.keys(contactFields).length) {
      await recordActivity(tx, { workspaceId: ctx.workspaceId, prospectId: id, actorId: ctx.userId, type: 'contact_updated', data: { fields: Object.keys(contactFields) } });
    }
    if (status && status !== p.status) await setStatus(tx, ctx, [p], status);
  });
  return getProspectOrThrow(ctx.db, ctx.workspaceId, id);
}

async function setStatus(tx: DbOrTx, ctx: WorkspaceContext, list: Pick<ProspectRow, 'id' | 'status'>[], status: ProspectStatus) {
  const changing = list.filter((p) => p.status !== status);
  if (!changing.length) return 0;
  const ids = changing.map((p) => p.id);
  await tx
    .update(prospects)
    .set({ status, archivedAt: status === 'archived' ? new Date() : null })
    .where(and(eq(prospects.workspaceId, ctx.workspaceId), inArray(prospects.id, ids)));
  await recordActivities(
    tx,
    changing.map((p) => ({ workspaceId: ctx.workspaceId, prospectId: p.id, actorId: ctx.userId, type: 'status_changed' as const, data: { from: p.status, to: status } })),
  );
  // Terminal outcomes stop any active sequences for these prospects.
  if (['not_interested', 'client', 'closed', 'archived'].includes(status)) {
    await stopSequencesFor(tx, ctx.workspaceId, ids, `Marked ${PROSPECT_STATUS_LABELS[status].toLowerCase()}`, ctx.userId);
  }
  return changing.length;
}

export async function stopSequencesFor(tx: DbOrTx, workspaceId: string, prospectIds: string[], reason: string, actorId: string | null, campaignId?: string) {
  if (!prospectIds.length) return 0;
  const conds = [
    eq(campaignRecipients.workspaceId, workspaceId),
    inArray(campaignRecipients.prospectId, prospectIds),
    inArray(campaignRecipients.status, ['pending', 'in_progress']),
  ];
  if (campaignId) conds.push(eq(campaignRecipients.campaignId, campaignId));
  const stopped = await tx
    .update(campaignRecipients)
    .set({ status: 'stopped', stoppedReason: reason, nextSendAt: null })
    .where(and(...conds))
    .returning({ id: campaignRecipients.id, prospectId: campaignRecipients.prospectId, campaignId: campaignRecipients.campaignId, pendingMessageId: campaignRecipients.pendingMessageId });
  const pendingIds = stopped.map((s) => s.pendingMessageId).filter(Boolean) as string[];
  if (pendingIds.length) {
    await tx.update(emailMessages).set({ status: 'cancelled', error: reason }).where(and(inArray(emailMessages.id, pendingIds), eq(emailMessages.status, 'queued')));
  }
  const names = stopped.length
    ? await tx.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(inArray(campaigns.id, [...new Set(stopped.map((s) => s.campaignId))]))
    : [];
  const nameById = new Map(names.map((n) => [n.id, n.name]));
  await recordActivities(
    tx,
    stopped.map((s) => ({ workspaceId, prospectId: s.prospectId, campaignId: s.campaignId, actorId, type: 'sequence_stopped' as const, data: { reason, campaignName: nameById.get(s.campaignId) ?? null } })),
  );
  return stopped.length;
}

export async function bulkAction(
  ctx: WorkspaceContext,
  input: { ids: string[]; action: 'status' | 'add_tag' | 'remove_tag' | 'archive' | 'delete' | 'add_to_campaign'; status?: ProspectStatus; tagId?: string; tagName?: string; campaignId?: string },
) {
  assertCan(ctx, 'prospects.write');
  const list = await ctx.db
    .select({ id: prospects.id, status: prospects.status })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, ctx.workspaceId), inArray(prospects.id, input.ids)));
  if (!list.length) throw notFound('Prospects');
  const ids = list.map((p) => p.id);
  switch (input.action) {
    case 'status': {
      if (!input.status) throw badRequest('Choose a status.');
      const n = await ctx.db.transaction((tx) => setStatus(tx, ctx, list, input.status!));
      return { affected: n };
    }
    case 'archive': {
      const n = await ctx.db.transaction((tx) => setStatus(tx, ctx, list, 'archived'));
      return { affected: n };
    }
    case 'add_tag': {
      const tag = input.tagId ? await getTag(ctx, input.tagId) : input.tagName ? await upsertTag(ctx, input.tagName) : null;
      if (!tag) throw badRequest('Choose a tag.');
      await ctx.db.transaction(async (tx) => {
        const inserted = await tx.insert(prospectTags).values(ids.map((id) => ({ prospectId: id, tagId: tag.id }))).onConflictDoNothing().returning({ prospectId: prospectTags.prospectId });
        await recordActivities(tx, inserted.map((r) => ({ workspaceId: ctx.workspaceId, prospectId: r.prospectId, actorId: ctx.userId, type: 'tag_added' as const, data: { tag: tag.name } })));
      });
      return { affected: ids.length, tag };
    }
    case 'remove_tag': {
      if (!input.tagId) throw badRequest('Choose a tag.');
      const tag = await getTag(ctx, input.tagId);
      await ctx.db.transaction(async (tx) => {
        const removed = await tx.delete(prospectTags).where(and(eq(prospectTags.tagId, tag.id), inArray(prospectTags.prospectId, ids))).returning({ prospectId: prospectTags.prospectId });
        await recordActivities(tx, removed.map((r) => ({ workspaceId: ctx.workspaceId, prospectId: r.prospectId, actorId: ctx.userId, type: 'tag_removed' as const, data: { tag: tag.name } })));
      });
      return { affected: ids.length };
    }
    case 'delete': {
      assertCan(ctx, 'prospects.delete');
      await ctx.db.delete(prospects).where(and(eq(prospects.workspaceId, ctx.workspaceId), inArray(prospects.id, ids)));
      await audit(ctx.db, ctx, { action: 'prospects.deleted', workspaceId: ctx.workspaceId, targetType: 'prospect', metadata: { count: ids.length } });
      return { affected: ids.length };
    }
    case 'add_to_campaign': {
      if (!input.campaignId) throw badRequest('Choose a campaign.');
      const { addRecipients } = await import('./campaigns');
      const res = await addRecipients(ctx, input.campaignId, ids);
      return { affected: res.added, skipped: res.skipped };
    }
  }
}

export async function deleteProspect(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, 'prospects.delete');
  await getProspectOrThrow(ctx.db, ctx.workspaceId, id);
  await ctx.db.delete(prospects).where(and(eq(prospects.id, id), eq(prospects.workspaceId, ctx.workspaceId)));
  await audit(ctx.db, ctx, { action: 'prospects.deleted', workspaceId: ctx.workspaceId, targetType: 'prospect', targetId: id });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function addNote(ctx: WorkspaceContext, prospectId: string, body: string) {
  assertCan(ctx, 'prospects.write');
  await getProspectOrThrow(ctx.db, ctx.workspaceId, prospectId);
  return ctx.db.transaction(async (tx) => {
    const [n] = await tx.insert(notes).values({ workspaceId: ctx.workspaceId, prospectId, authorId: ctx.userId, body }).returning();
    await recordActivity(tx, { workspaceId: ctx.workspaceId, prospectId, actorId: ctx.userId, type: 'note_added', data: { noteId: n.id, preview: body.slice(0, 120) } });
    return n;
  });
}

async function getNoteForEdit(ctx: WorkspaceContext, noteId: string) {
  const [n] = await ctx.db.select().from(notes).where(and(eq(notes.id, noteId), eq(notes.workspaceId, ctx.workspaceId))).limit(1);
  if (!n) throw notFound('Note');
  if (n.authorId !== ctx.userId && ctx.role === 'member') throw new AppError('FORBIDDEN', 'You can only edit your own notes.');
  return n;
}

export async function updateNote(ctx: WorkspaceContext, noteId: string, body: string) {
  await getNoteForEdit(ctx, noteId);
  const [n] = await ctx.db.update(notes).set({ body }).where(eq(notes.id, noteId)).returning();
  return n;
}

export async function deleteNote(ctx: WorkspaceContext, noteId: string) {
  await getNoteForEdit(ctx, noteId);
  await ctx.db.delete(notes).where(eq(notes.id, noteId));
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function listTags(ctx: WorkspaceContext) {
  const rows = await ctx.db
    .select({ id: tags.id, name: tags.name, count: sql<number>`count(${prospectTags.prospectId})::int` })
    .from(tags)
    .leftJoin(prospectTags, eq(prospectTags.tagId, tags.id))
    .where(eq(tags.workspaceId, ctx.workspaceId))
    .groupBy(tags.id)
    .orderBy(tags.name);
  return rows;
}

async function getTag(ctx: WorkspaceContext, id: string) {
  const [t] = await ctx.db.select().from(tags).where(and(eq(tags.id, id), eq(tags.workspaceId, ctx.workspaceId))).limit(1);
  if (!t) throw notFound('Tag');
  return t;
}

export async function upsertTag(ctx: WorkspaceContext, name: string) {
  assertCan(ctx, 'prospects.write');
  const clean = name.trim().slice(0, 40);
  if (!clean) throw badRequest('Name the tag.');
  const [existing] = await ctx.db.select().from(tags).where(and(eq(tags.workspaceId, ctx.workspaceId), sql`lower(${tags.name}) = ${clean.toLowerCase()}`)).limit(1);
  if (existing) return existing;
  const [t] = await ctx.db.insert(tags).values({ workspaceId: ctx.workspaceId, name: clean }).onConflictDoNothing().returning();
  if (t) return t;
  const [again] = await ctx.db.select().from(tags).where(and(eq(tags.workspaceId, ctx.workspaceId), sql`lower(${tags.name}) = ${clean.toLowerCase()}`)).limit(1);
  return again;
}

export async function renameTag(ctx: WorkspaceContext, id: string, name: string) {
  assertCan(ctx, 'prospects.write');
  await getTag(ctx, id);
  try {
    const [t] = await ctx.db.update(tags).set({ name: name.trim() }).where(eq(tags.id, id)).returning();
    return t;
  } catch {
    throw new AppError('CONFLICT', 'A tag with this name already exists.');
  }
}

export async function deleteTag(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, 'prospects.write');
  await getTag(ctx, id);
  await ctx.db.delete(tags).where(eq(tags.id, id));
}

export async function addTagToProspect(ctx: WorkspaceContext, prospectId: string, input: { tagId?: string; name?: string }) {
  assertCan(ctx, 'prospects.write');
  await getProspectOrThrow(ctx.db, ctx.workspaceId, prospectId);
  const tag = input.tagId ? await getTag(ctx, input.tagId) : await upsertTag(ctx, input.name ?? '');
  const inserted = await ctx.db.insert(prospectTags).values({ prospectId, tagId: tag.id }).onConflictDoNothing().returning();
  if (inserted.length) await recordActivity(ctx.db, { workspaceId: ctx.workspaceId, prospectId, actorId: ctx.userId, type: 'tag_added', data: { tag: tag.name } });
  return tag;
}

export async function removeTagFromProspect(ctx: WorkspaceContext, prospectId: string, tagId: string) {
  assertCan(ctx, 'prospects.write');
  await getProspectOrThrow(ctx.db, ctx.workspaceId, prospectId);
  const tag = await getTag(ctx, tagId);
  const removed = await ctx.db.delete(prospectTags).where(and(eq(prospectTags.prospectId, prospectId), eq(prospectTags.tagId, tagId))).returning();
  if (removed.length) await recordActivity(ctx.db, { workspaceId: ctx.workspaceId, prospectId, actorId: ctx.userId, type: 'tag_removed', data: { tag: tag.name } });
}

// ---------------------------------------------------------------------------
// Manual follow-up reminders
// ---------------------------------------------------------------------------

export async function scheduleFollowUp(ctx: WorkspaceContext, input: { prospectId: string; dueAt: string; note?: string | null }) {
  assertCan(ctx, 'prospects.write');
  await getProspectOrThrow(ctx.db, ctx.workspaceId, input.prospectId);
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw badRequest('Choose a valid date.');
  return ctx.db.transaction(async (tx) => {
    const [f] = await tx
      .insert(followUps)
      .values({ workspaceId: ctx.workspaceId, prospectId: input.prospectId, createdBy: ctx.userId, dueAt, note: input.note ?? null })
      .returning();
    await recordActivity(tx, { workspaceId: ctx.workspaceId, prospectId: input.prospectId, actorId: ctx.userId, type: 'follow_up_scheduled', data: { followUpId: f.id, dueAt: dueAt.toISOString(), note: input.note ?? null } });
    return f;
  });
}

export async function updateFollowUp(ctx: WorkspaceContext, id: string, input: { status?: 'done' | 'cancelled' | 'scheduled'; dueAt?: string; note?: string | null }) {
  assertCan(ctx, 'prospects.write');
  const [f] = await ctx.db.select().from(followUps).where(and(eq(followUps.id, id), eq(followUps.workspaceId, ctx.workspaceId))).limit(1);
  if (!f) throw notFound('Follow-up');
  const update: Partial<typeof followUps.$inferInsert> = {};
  if (input.dueAt) update.dueAt = new Date(input.dueAt);
  if (input.note !== undefined) update.note = input.note;
  if (input.status) {
    update.status = input.status;
    update.completedAt = input.status === 'done' ? new Date() : null;
    if (input.status === 'scheduled') update.notifiedAt = null;
  }
  const [updated] = await ctx.db.update(followUps).set(update).where(eq(followUps.id, id)).returning();
  if (input.status === 'done' || input.status === 'cancelled') {
    await recordActivity(ctx.db, {
      workspaceId: ctx.workspaceId,
      prospectId: f.prospectId,
      actorId: ctx.userId,
      type: input.status === 'done' ? 'follow_up_completed' : 'follow_up_cancelled',
      data: { followUpId: id },
    });
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Export (user-created data only)
// ---------------------------------------------------------------------------

export const EXPORT_COLUMNS = [
  'id',
  'status',
  'name',
  'contact_first_name',
  'contact_last_name',
  'email',
  'phone',
  'location',
  'category',
  'website_status',
  'social_profile_only',
  'website_url_entered',
  'tags',
  'google_place_id',
  'google_maps_url',
  'source',
  'last_contacted_at',
  'created_at',
] as const;

/**
 * Exports prospects. Contains only data Localy may retain: the user's own
 * entries, Localy's workflow data, and Google place IDs (with a Google Maps
 * link built from the ID). Google-provided names, addresses, phone numbers,
 * ratings and hours are not included.
 */
export async function exportProspects(ctx: WorkspaceContext, q: Omit<ProspectListQuery, 'page' | 'pageSize'>) {
  assertCan(ctx, 'data.export', 'Only workspace owners and admins can export data.');
  await getEffectivePlan(ctx.db, ctx.workspaceId);
  const rows = await ctx.db
    .select()
    .from(prospects)
    .where(and(...listConditions(ctx, { ...q, page: 1, pageSize: 1 })))
    .orderBy(desc(prospects.createdAt))
    .limit(50_000);
  const tagMap = await tagsFor(ctx.db, rows.map((r) => r.id));
  await audit(ctx.db, ctx, { action: 'data.exported', workspaceId: ctx.workspaceId, targetType: 'prospects', metadata: { count: rows.length } });
  return rows.map((p) => ({
    id: p.id,
    status: p.status,
    name: p.name ?? '',
    contact_first_name: p.contactFirstName ?? '',
    contact_last_name: p.contactLastName ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
    location: p.locationLabel ?? '',
    category: p.categoryLabel ?? '',
    website_status: p.websiteStatus,
    social_profile_only: p.socialProfileOnly ? 'yes' : 'no',
    website_url_entered: p.websiteUrl ?? '',
    tags: (tagMap.get(p.id) ?? []).map((t) => t.name).join('; '),
    google_place_id: p.placeId ?? '',
    google_maps_url: p.placeId ? googleMapsUrlForPlaceId(p.placeId) : '',
    source: p.source,
    last_contacted_at: p.lastContactedAt?.toISOString() ?? '',
    created_at: p.createdAt.toISOString(),
  }));
}

export function toCsv(rows: Record<string, string>[], columns: readonly string[]) {
  const esc = (v: string) => {
    // Neutralize spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(String(r[c] ?? ''))).join(','))].join('\r\n');
}

export async function prospectCounts(ctx: WorkspaceContext) {
  const rows = await ctx.db
    .select({ status: prospects.status, n: sql<number>`count(*)::int` })
    .from(prospects)
    .where(eq(prospects.workspaceId, ctx.workspaceId))
    .groupBy(prospects.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<ProspectStatus, number>>;
}

export async function prospectLimitStatus(ctx: WorkspaceContext) {
  return getUsageItem(ctx.db, ctx.workspaceId, 'prospects');
}

