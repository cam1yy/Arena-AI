import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  discoveredPlaces,
  prospects,
  savedSearches,
  searchHistory,
  type StoredSearchConfig,
} from '@localy/database';
import {
  categoryLabel,
  passesFilters,
  type DiscoveryResponse,
  type DiscoveryResult,
  type DiscoverySearchInput,
  type LocationValue,
  type SavedSearchItem,
  type SearchHistoryItem,
} from '@localy/shared';
import { AppError, badRequest, notFound } from '../errors';
import type { WorkspaceContext } from '../context';
import { assertCan } from '../permissions';
import { analyzePlace, geocodeAddress, resolveLocation, textSearch, type TextSearchPage } from '../google/places';
import { checkWebsite, type WebsiteCheckResult } from '../google/website-check';
import { mapWithConcurrency } from '../http';
import { assertActiveSubscription, getUsageItem, incrementUsage } from './usage';
import { recordActivity } from './activity';

const MAX_QUERIES = 5;

function startOfMonthUtc(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function buildQueries(input: Pick<DiscoverySearchInput, 'categories' | 'keyword'>): string[] {
  const keyword = input.keyword?.trim();
  const cats = [...new Set(input.categories.map((c) => c.trim()).filter(Boolean))];
  let queries: string[];
  if (cats.length && keyword) queries = cats.map((c) => `${keyword} ${categoryQuery(c)}`);
  else if (cats.length) queries = cats.map(categoryQuery);
  else if (keyword) queries = [keyword];
  else queries = [];
  return queries.slice(0, MAX_QUERIES);
}

function categoryQuery(idOrText: string): string {
  const label = categoryLabel(idOrText);
  return label.toLowerCase();
}

/**
 * Ensures the search location has coordinates. Google coordinates are only
 * cached for 30 days, so older saved searches are re-resolved from their place
 * ID; typed labels (for example from onboarding) are geocoded.
 */
export async function ensureCoordinates(location: LocationValue, workspaceId: string): Promise<LocationValue & { lat: number; lng: number }> {
  if (typeof location.lat === 'number' && typeof location.lng === 'number') return location as LocationValue & { lat: number; lng: number };
  if (location.placeId) {
    const resolved = await resolveLocation(location.placeId, { workspaceId });
    return { ...location, lat: resolved.lat, lng: resolved.lng, source: 'google', resolvedAt: new Date().toISOString() };
  }
  if (location.label?.trim()) {
    const resolved = await geocodeAddress(location.label, workspaceId);
    return { ...location, placeId: resolved.placeId, lat: resolved.lat, lng: resolved.lng, source: 'google', resolvedAt: new Date().toISOString() };
  }
  throw new AppError('INVALID_ADDRESS', 'Choose a location on the map before searching.');
}

function locationForStorage(loc: LocationValue): LocationValue {
  // Google-sourced coordinates may be cached for at most 30 days. We stamp them
  // so the cleanup job can remove them; user-provided pins are user data.
  return { ...loc, resolvedAt: loc.source === 'google' ? (loc.resolvedAt ?? new Date().toISOString()) : (loc.resolvedAt ?? null) };
}

export async function runDiscovery(ctx: WorkspaceContext, input: DiscoverySearchInput): Promise<DiscoveryResponse> {
  assertCan(ctx, 'discovery.run');
  const plan = await assertActiveSubscription(ctx.db, ctx.workspaceId);
  const queries = buildQueries(input);
  if (!queries.length) throw badRequest('Choose at least one business category or enter a keyword.');
  const isContinuation = Boolean(input.pageTokens && Object.keys(input.pageTokens).length);
  const activeQueries = isContinuation ? queries.filter((q) => input.pageTokens?.[q]) : queries;
  if (!activeQueries.length) throw badRequest('There are no more results for this search.');

  const requests = await getUsageItem(ctx.db, ctx.workspaceId, 'places_requests', plan);
  if (requests.used + activeQueries.length > requests.limit) {
    throw new AppError('LIMIT_REACHED', `This search needs ${activeQueries.length} map requests, but you have ${Math.max(0, requests.limit - requests.used)} left this month. Remove a category or upgrade your plan.`, {
      details: { usage: requests, upgradeUrl: '/app/billing' },
    });
  }
  const discovered = await getUsageItem(ctx.db, ctx.workspaceId, 'businesses_discovered', plan);
  if (discovered.exceeded) {
    throw new AppError('LIMIT_REACHED', `You've reached your monthly discovery limit of ${discovered.limit.toLocaleString()} businesses. It resets at the start of next month, or you can upgrade now.`, {
      details: { usage: discovered, upgradeUrl: '/app/billing' },
    });
  }

  const location = await ensureCoordinates(input.location, ctx.workspaceId);
  const center = { lat: location.lat, lng: location.lng };

  const pages = await mapWithConcurrency(activeQueries, 3, async (q) => {
    const page: TextSearchPage = await textSearch({
      query: q,
      center,
      radiusMeters: input.radiusMeters,
      pageToken: input.pageTokens?.[q] ?? null,
      workspaceId: ctx.workspaceId,
    });
    return { q, page };
  });
  await incrementUsage(ctx.db, ctx.workspaceId, 'places_requests', activeQueries.length);

  const merged = new Map<string, DiscoveryResult>();
  let excludedOutsideRadius = 0;
  const nextTokens: Record<string, string> = {};
  for (const { q, page } of pages) {
    if (page.nextPageToken) nextTokens[q] = page.nextPageToken;
    for (const place of page.places) {
      const existing = merged.get(place.placeId);
      if (existing) {
        if (!existing.matchedQueries.includes(q)) existing.matchedQueries.push(q);
        continue;
      }
      const analysis = analyzePlace(place, center);
      if (analysis.distanceMeters !== null && analysis.distanceMeters > input.radiusMeters && !place.pureServiceArea) {
        excludedOutsideRadius++;
        continue;
      }
      merged.set(place.placeId, { ...place, ...analysis, websiteCheck: null, matchedQueries: [q], prospectId: null });
    }
  }

  const all = [...merged.values()];
  // Metering: businesses first seen by this workspace this calendar month.
  const ids = all.map((r) => r.placeId);
  let newThisMonth = ids;
  if (ids.length) {
    const seen = await ctx.db
      .select({ placeId: discoveredPlaces.placeId })
      .from(discoveredPlaces)
      .where(and(eq(discoveredPlaces.workspaceId, ctx.workspaceId), inArray(discoveredPlaces.placeId, ids), gte(discoveredPlaces.lastSeenAt, startOfMonthUtc())));
    const seenSet = new Set(seen.map((s) => s.placeId));
    newThisMonth = ids.filter((id) => !seenSet.has(id));
  }
  let limitNotice: string | null = null;
  let results = all;
  const allowance = Math.max(0, discovered.limit - discovered.used);
  if (newThisMonth.length > allowance) {
    const allowedNew = new Set(newThisMonth.slice(0, allowance));
    const newSet = new Set(newThisMonth);
    const dropped = newThisMonth.length - allowance;
    results = all.filter((r) => !newSet.has(r.placeId) || allowedNew.has(r.placeId));
    newThisMonth = [...allowedNew];
    limitNotice = `You've reached your monthly discovery limit. ${dropped} additional ${dropped === 1 ? 'business was' : 'businesses were'} found but not shown. Upgrade your plan to see more.`;
  }
  await incrementUsage(ctx.db, ctx.workspaceId, 'businesses_discovered', newThisMonth.length);

  // Link results that are already saved as prospects.
  if (results.length) {
    const saved = await ctx.db
      .select({ id: prospects.id, placeId: prospects.placeId })
      .from(prospects)
      .where(and(eq(prospects.workspaceId, ctx.workspaceId), inArray(prospects.placeId, results.map((r) => r.placeId))));
    const byPlace = new Map(saved.map((s) => [s.placeId, s.id]));
    for (const r of results) r.prospectId = byPlace.get(r.placeId) ?? null;
  }

  // All in-area results are returned; filters are applied in the browser so
  // changing a filter never costs another Google Maps request.
  const filtered = results.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  const opportunityCount = filtered.filter((r) => r.opportunity).length;
  const matchingCount = filtered.filter((r) => passesFilters(r, input.filters)).length;

  let searchId = input.searchId ?? null;
  const storedLocation = locationForStorage(location);
  if (searchId && isContinuation) {
    const [row] = await ctx.db
      .select({ id: searchHistory.id, placeIds: searchHistory.placeIds })
      .from(searchHistory)
      .where(and(eq(searchHistory.id, searchId), eq(searchHistory.workspaceId, ctx.workspaceId)));
    if (row) {
      const placeIds = [...new Set([...row.placeIds, ...filtered.map((r) => r.placeId)])];
      await ctx.db
        .update(searchHistory)
        .set({
          placeIds,
          resultCount: placeIds.length,
          opportunityCount: sql`${searchHistory.opportunityCount} + ${opportunityCount}`,
          requestsMade: sql`${searchHistory.requestsMade} + ${activeQueries.length}`,
        })
        .where(eq(searchHistory.id, row.id));
    } else searchId = null;
  }
  if (!searchId || !isContinuation) {
    const [row] = await ctx.db
      .insert(searchHistory)
      .values({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        categories: input.categories,
        keyword: input.keyword ?? null,
        location: storedLocation,
        radiusMeters: input.radiusMeters,
        filters: input.filters,
        resultCount: filtered.length,
        opportunityCount,
        placeIds: filtered.map((r) => r.placeId),
        requestsMade: activeQueries.length,
        coordsCachedAt: storedLocation.source === 'google' ? new Date() : null,
      })
      .returning({ id: searchHistory.id });
    searchId = row.id;
    await recordActivity(ctx.db, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      type: 'discovery_search',
      data: { searchId, found: filtered.length, matching: matchingCount, opportunities: opportunityCount, label: searchLabel(input.categories, input.keyword, location.label) },
    });
  }

  if (results.length) {
    const now = new Date();
    await ctx.db
      .insert(discoveredPlaces)
      .values(results.map((r) => ({ workspaceId: ctx.workspaceId, placeId: r.placeId, firstSearchId: searchId })))
      .onConflictDoUpdate({ target: [discoveredPlaces.workspaceId, discoveredPlaces.placeId], set: { lastSeenAt: now } });
  }

  if (input.savedSearchId) {
    await ctx.db
      .update(savedSearches)
      .set({ lastRunAt: new Date() })
      .where(and(eq(savedSearches.id, input.savedSearchId), eq(savedSearches.workspaceId, ctx.workspaceId)));
  }

  const [discoveredAfter, requestsAfter] = await Promise.all([
    getUsageItem(ctx.db, ctx.workspaceId, 'businesses_discovered', plan),
    getUsageItem(ctx.db, ctx.workspaceId, 'places_requests', plan),
  ]);
  return {
    searchId: searchId!,
    results: filtered,
    pageTokens: nextTokens,
    hasMore: Object.keys(nextTokens).length > 0,
    excludedOutsideRadius,
    requestsMade: activeQueries.length,
    usage: { discovered: discoveredAfter, requests: requestsAfter },
    limitNotice,
  };
}

/** Place IDs this workspace is allowed to look up live (its prospects and discovery results). */
export async function authorizedPlaceIds(ctx: WorkspaceContext, placeIds: string[]): Promise<Set<string>> {
  if (!placeIds.length) return new Set();
  const [fromProspects, fromDiscovery] = await Promise.all([
    ctx.db
      .select({ placeId: prospects.placeId })
      .from(prospects)
      .where(and(eq(prospects.workspaceId, ctx.workspaceId), inArray(prospects.placeId, placeIds))),
    ctx.db
      .select({ placeId: discoveredPlaces.placeId })
      .from(discoveredPlaces)
      .where(and(eq(discoveredPlaces.workspaceId, ctx.workspaceId), inArray(discoveredPlaces.placeId, placeIds))),
  ]);
  return new Set([...fromProspects.map((r) => r.placeId!), ...fromDiscovery.map((r) => r.placeId)]);
}

export function searchLabel(categories: string[], keyword: string | null | undefined, locationLabel: string): string {
  const what = [keyword, ...categories.map(categoryLabel)].filter(Boolean).join(', ') || 'Businesses';
  const where = locationLabel.split(',')[0];
  return `${what} near ${where}`;
}

/** Verifies listed websites on request (see website-check.ts for the method). */
export async function verifyWebsites(ctx: WorkspaceContext, items: { placeId: string; url: string }[]) {
  assertCan(ctx, 'discovery.run');
  await assertActiveSubscription(ctx.db, ctx.workspaceId);
  const unique = items.slice(0, 40);
  const results = await mapWithConcurrency(unique, 6, async (item) => ({ placeId: item.placeId, ...(await checkWebsite(item.url, ctx.workspaceId)) }));
  // Keep saved prospects' analysis up to date.
  for (const r of results) {
    await ctx.db
      .update(prospects)
      .set({ websiteStatus: r.status, websiteCheckedAt: new Date(r.checkedAt), websiteHttpStatus: r.httpStatus })
      .where(and(eq(prospects.workspaceId, ctx.workspaceId), eq(prospects.placeId, r.placeId)));
  }
  return results as (WebsiteCheckResult & { placeId: string })[];
}

// ---------------------------------------------------------------------------
// Search history and saved searches
// ---------------------------------------------------------------------------

export async function listSearchHistory(ctx: WorkspaceContext, limit = 30): Promise<SearchHistoryItem[]> {
  const rows = await ctx.db.query.searchHistory.findMany({
    where: eq(searchHistory.workspaceId, ctx.workspaceId),
    orderBy: [desc(searchHistory.createdAt)],
    limit,
    with: undefined,
  });
  const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
  const names = userIds.length
    ? await ctx.db.query.users.findMany({ where: (u, { inArray: ia }) => ia(u.id, userIds), columns: { id: true, name: true } })
    : [];
  const nameById = new Map(names.map((n) => [n.id, n.name]));
  return rows.map((r) => ({
    id: r.id,
    label: searchLabel(r.categories, r.keyword, r.location.label),
    categories: r.categories,
    keyword: r.keyword,
    location: r.location,
    radiusMeters: r.radiusMeters,
    filters: r.filters,
    resultCount: r.resultCount,
    opportunityCount: r.opportunityCount,
    createdAt: r.createdAt.toISOString(),
    user: r.userId ? { id: r.userId, name: nameById.get(r.userId) ?? 'Former member' } : null,
  }));
}

export async function deleteSearchHistory(ctx: WorkspaceContext, id?: string) {
  assertCan(ctx, 'discovery.run');
  if (id) await ctx.db.delete(searchHistory).where(and(eq(searchHistory.id, id), eq(searchHistory.workspaceId, ctx.workspaceId)));
  else await ctx.db.delete(searchHistory).where(eq(searchHistory.workspaceId, ctx.workspaceId));
}

function toSavedItem(r: typeof savedSearches.$inferSelect): SavedSearchItem {
  return { id: r.id, name: r.name, config: r.config, lastRunAt: r.lastRunAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() };
}

export async function listSavedSearches(ctx: WorkspaceContext): Promise<SavedSearchItem[]> {
  const rows = await ctx.db.select().from(savedSearches).where(eq(savedSearches.workspaceId, ctx.workspaceId)).orderBy(desc(savedSearches.updatedAt));
  return rows.map(toSavedItem);
}

export async function createSavedSearch(ctx: WorkspaceContext, input: { name: string; config: StoredSearchConfig }) {
  assertCan(ctx, 'discovery.run');
  const location = locationForStorage(input.config.location);
  const [row] = await ctx.db
    .insert(savedSearches)
    .values({
      workspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
      name: input.name,
      config: { ...input.config, location },
      coordsCachedAt: location.source === 'google' && location.lat != null ? new Date() : null,
    })
    .returning();
  return toSavedItem(row);
}

export async function updateSavedSearch(ctx: WorkspaceContext, id: string, input: { name: string; config: StoredSearchConfig }) {
  assertCan(ctx, 'discovery.run');
  const location = locationForStorage(input.config.location);
  const [row] = await ctx.db
    .update(savedSearches)
    .set({ name: input.name, config: { ...input.config, location }, coordsCachedAt: location.source === 'google' && location.lat != null ? new Date() : null })
    .where(and(eq(savedSearches.id, id), eq(savedSearches.workspaceId, ctx.workspaceId)))
    .returning();
  if (!row) throw notFound('Saved search');
  return toSavedItem(row);
}

export async function deleteSavedSearch(ctx: WorkspaceContext, id: string) {
  assertCan(ctx, 'discovery.run');
  const res = await ctx.db
    .delete(savedSearches)
    .where(and(eq(savedSearches.id, id), eq(savedSearches.workspaceId, ctx.workspaceId)))
    .returning({ id: savedSearches.id });
  if (!res.length) throw notFound('Saved search');
}
