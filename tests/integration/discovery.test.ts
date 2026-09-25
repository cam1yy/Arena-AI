import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, prospects, searchHistory, usageCounters } from '@localy/database';
import { maintenance } from '@localy/core';
import { getApp, signUp } from '../support/harness';

let app: Awaited<ReturnType<typeof getApp>>;
beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

const location = { label: 'Cape Town, South Africa', placeId: 'loc-cape-town', lat: -33.9249, lng: 18.4241, source: 'google' as const };
const search = (overrides: Record<string, unknown> = {}) => ({
  categories: ['barbers'],
  keyword: null,
  location,
  radiusMeters: 10_000,
  filters: { website: 'any', phone: 'any', operationalOnly: true },
  ...overrides,
});

describe('business discovery', () => {
  it('searches through Places API (New) with a field mask and the server key, filters by radius, and classifies websites honestly', async () => {
    const { client } = await signUp(app);
    const res = await client.json<{ results: { placeId: string; name: string; websiteStatus: string; socialProfileOnly: boolean; opportunity: boolean; distanceMeters: number; signals: Record<string, boolean> }[]; excludedOutsideRadius: number; hasMore: boolean; searchId: string }>('POST', '/api/discovery/search', search());
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r) => r.placeId);
    // The far-away business is outside the 10 km circle and is excluded.
    expect(ids).not.toContain('test-place-4');
    expect(res.body.excludedOutsideRadius).toBe(1);
    const one = res.body.results.find((r) => r.placeId === 'test-place-1')!;
    expect(one.websiteStatus).toBe('not_listed');
    expect(one.opportunity).toBe(true);
    expect(one.signals).toMatchObject({ noWebsiteListed: true, strongRating: true, highReviewCount: true, hasPhone: true });
    const two = res.body.results.find((r) => r.placeId === 'test-place-2')!;
    expect(two.websiteStatus).toBe('listed');
    expect(two.socialProfileOnly).toBe(true);
    expect(two.opportunity).toBe(true);
    expect(res.body.hasMore).toBe(true);
    // Results are sorted by distance.
    const distances = res.body.results.map((r) => r.distanceMeters);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('stores only place IDs and search settings, never Google business details', async () => {
    const { client, workspaceId } = await signUp(app);
    const res = await client.json<{ searchId: string; results: { placeId: string; websiteStatus: string; socialProfileOnly: boolean; signals: Record<string, boolean> }[] }>('POST', '/api/discovery/search', search());
    const [h] = await getDb().select().from(searchHistory).where(eq(searchHistory.id, res.body.searchId));
    expect(h.placeIds).toContain('test-place-1');
    expect(JSON.stringify(h)).not.toContain('Fixture Barbers One');
    const r = res.body.results.find((x) => x.placeId === 'test-place-1')!;
    const saved = await client.json<{ created: { id: string }[] }>('POST', '/api/prospects/from-discovery', { searchId: res.body.searchId, businesses: [{ placeId: r.placeId, websiteStatus: r.websiteStatus, socialProfileOnly: r.socialProfileOnly, signals: r.signals }] });
    expect(saved.status).toBe(201);
    const [p] = await getDb().select().from(prospects).where(eq(prospects.id, saved.body.created[0].id));
    expect(p.placeId).toBe('test-place-1');
    expect(p.name).toBeNull();
    expect(p.phone).toBeNull();
    expect(p.websiteStatus).toBe('not_listed');
    expect(JSON.stringify(p)).not.toContain('Fixture Barbers One');
    expect(JSON.stringify(p)).not.toContain('555 0001');
    // Business details come back live on the detail page.
    const detail = await client.json<{ prospect: { displayName: string; live: { phone: string } } }>('GET', `/api/prospects/${p.id}`);
    expect(detail.body.prospect.displayName).toBe('Fixture Barbers One');
    expect(detail.body.prospect.live.phone).toBe('021 555 0001');
    expect(workspaceId).toBeTruthy();
  });

  it('does not re-request Google when saving businesses from its own results, but verifies unknown place IDs live', async () => {
    const { client } = await signUp(app);
    const res = await client.json<{ searchId: string; results: { placeId: string; websiteStatus: string; socialProfileOnly: boolean; signals: Record<string, boolean> }[] }>('POST', '/api/discovery/search', search({ categories: ['plumbers'] }));
    const r = res.body.results[0];
    const saved = await client.json<{ created: { id: string }[] }>('POST', '/api/prospects/from-discovery', { businesses: [{ placeId: r.placeId, websiteStatus: 'not_listed', socialProfileOnly: false, signals: {} }] });
    // Client-sent analysis for a discovered place is accepted as-is (it is Localy's own derived data).
    const [p] = await getDb().select().from(prospects).where(eq(prospects.id, saved.body.created[0].id));
    expect(p.websiteStatus).toBe('not_listed');
    // A place the workspace never discovered is verified against Google instead of trusting the client.
    const other = await client.json<{ created: { id: string }[] }>('POST', '/api/prospects/from-discovery', { businesses: [{ placeId: 'test-place-4', websiteStatus: 'listed', socialProfileOnly: false, signals: {} }] });
    const [q] = await getDb().select().from(prospects).where(eq(prospects.id, other.body.created[0].id));
    expect(q.websiteStatus).toBe('not_listed');
  });

  it('meters unique businesses per month and Places requests per search', async () => {
    const { client, workspaceId } = await signUp(app);
    await client.json('POST', '/api/discovery/search', search());
    await client.json('POST', '/api/discovery/search', search());
    const rows = await getDb().select().from(usageCounters).where(eq(usageCounters.workspaceId, workspaceId));
    const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r.count]));
    expect(byMetric.places_requests).toBe(2);
    // The same businesses found twice count once.
    expect(byMetric.businesses_discovered).toBe(3);
  });

  it('explains limits instead of silently failing', async () => {
    const { client, workspaceId } = await signUp(app);
    await getDb().execute(`update subscriptions set limit_overrides = '{"places_requests": 1}'::jsonb where workspace_id = '${workspaceId}'` as never);
    const res = await client.json<{ error: { code: string; message: string; details: { usage: { used: number; limit: number } } } }>('POST', '/api/discovery/search', search({ categories: ['barbers', 'plumbers'] }));
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('LIMIT_REACHED');
    expect(res.body.error.message).toMatch(/needs 2 map requests/);
  });

  it('blocks discovery when the subscription is inactive', async () => {
    const { client, workspaceId } = await signUp(app);
    await getDb().execute(`update subscriptions set trial_ends_at = now() - interval '1 day' where workspace_id = '${workspaceId}'` as never);
    const res = await client.json<{ error: { code: string } }>('POST', '/api/discovery/search', search());
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('surfaces Google quota errors as a friendly message after retrying', async () => {
    const { client } = await signUp(app);
    // Force 3 consecutive 429s (initial attempt + 2 retries).
    const fake = await import('../support/fake-control');
    await fake.failNext(429, 3);
    const out = await client.json<{ error: { code: string; message: string } }>('POST', '/api/discovery/search', search());
    expect(out.status).toBe(503);
    expect(out.body.error.code).toBe('EXTERNAL_QUOTA_EXCEEDED');
    expect(out.body.error.message).not.toMatch(/stack|Error:/);
  });

  it('resolves locations, reverse geocodes pins and reports unknown addresses clearly', async () => {
    const { client } = await signUp(app);
    const auto = await client.json<{ suggestions: { placeId: string }[] }>('GET', '/api/locations/autocomplete?q=Cape');
    expect(auto.body.suggestions[0].placeId).toBe('loc-cape-town');
    const resolved = await client.json<{ location: { lat: number; lng: number } }>('GET', '/api/locations/resolve?placeId=loc-cape-town');
    expect(resolved.body.location.lat).toBeCloseTo(-33.9249);
    const rev = await client.json<{ location: { label: string } }>('GET', '/api/locations/reverse?lat=-33.9&lng=18.4');
    expect(rev.body.location.label).toMatch(/Sea Point/);
    const bad = await client.json<{ error: { code: string } }>('GET', '/api/locations/geocode?address=nowhere%20land');
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INVALID_ADDRESS');
  });

  it('only returns live details for places the workspace discovered or saved', async () => {
    const { client } = await signUp(app);
    const denied = await client.json('GET', '/api/discovery/place/test-place-3');
    expect(denied.status).toBe(404);
    await client.json('POST', '/api/discovery/search', search({ categories: ['plumbers'] }));
    const allowed = await client.json<{ place: { name: string } }>('GET', '/api/discovery/place/test-place-3');
    expect(allowed.body.place.name).toBe('Fixture Plumbing Co');
  });

  it('clears cached Google coordinates older than 30 days but keeps place IDs', async () => {
    const { client } = await signUp(app);
    const res = await client.json<{ searchId: string }>('POST', '/api/discovery/search', search());
    await getDb().update(searchHistory).set({ coordsCachedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(searchHistory.id, res.body.searchId));
    await maintenance.runCleanup(getDb());
    const [h] = await getDb().select().from(searchHistory).where(eq(searchHistory.id, res.body.searchId));
    expect(h.location.lat).toBeNull();
    expect(h.location.lng).toBeNull();
    expect(h.location.placeId).toBe('loc-cape-town');
    expect(h.placeIds.length).toBeGreaterThan(0);
  });

  it('saves, reruns and deletes saved searches', async () => {
    const { client } = await signUp(app);
    const created = await client.json<{ savedSearch: { id: string } }>('POST', '/api/saved-searches', { name: 'Local Barbers, Cape Town', config: { categories: ['barbers'], keyword: null, location, radiusMeters: 10_000, filters: { website: 'not_listed', phone: 'any', operationalOnly: true } } });
    expect(created.status).toBe(200);
    const list = await client.json<{ savedSearches: { name: string }[] }>('GET', '/api/saved-searches');
    expect(list.body.savedSearches[0].name).toBe('Local Barbers, Cape Town');
    const run = await client.json('POST', '/api/discovery/search', { ...search(), savedSearchId: created.body.savedSearch.id });
    expect(run.status).toBe(200);
    expect((await client.json('DELETE', `/api/saved-searches/${created.body.savedSearch.id}`)).status).toBe(200);
  });
});
