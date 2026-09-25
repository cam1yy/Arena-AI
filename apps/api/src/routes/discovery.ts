import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '@localy/database';
import { discoverySearchSchema, savedSearchSchema } from '@localy/shared';
import { AppError, discovery, places } from '@localy/core';
import { getConfig } from '@localy/config';
import { parse, idParam } from '../http';

export default async function discoveryRoutes(app: FastifyInstance) {
  const db = getDb();
  void db;
  const searchLimit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const autocompleteLimit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

  app.addHook('preHandler', app.requireWorkspace);

  const requirePlaces = () => {
    if (!getConfig().features.places) {
      throw new AppError('NOT_CONFIGURED', 'Business discovery needs a Google Maps Platform server key. Ask an administrator to set GOOGLE_MAPS_API_KEY.', {
        details: { envVars: ['GOOGLE_MAPS_API_KEY'] },
      });
    }
  };

  app.get('/api/locations/autocomplete', autocompleteLimit, async (req) => {
    requirePlaces();
    const q = parse(
      z.object({ q: z.string().trim().min(2).max(120), session: z.string().max(100).optional(), lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }),
      req.query,
    );
    const suggestions = await places.autocompleteLocations(q.q, {
      sessionToken: q.session,
      bias: q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null,
      workspaceId: req.wctx.workspaceId,
    });
    return { suggestions };
  });

  app.get('/api/locations/resolve', autocompleteLimit, async (req) => {
    requirePlaces();
    const q = parse(z.object({ placeId: z.string().min(1).max(300), session: z.string().max(100).optional() }), req.query);
    return { location: await places.resolveLocation(q.placeId, { sessionToken: q.session, workspaceId: req.wctx.workspaceId }) };
  });

  app.get('/api/locations/reverse', autocompleteLimit, async (req) => {
    requirePlaces();
    const q = parse(z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }), req.query);
    return { location: await places.reverseGeocode({ lat: q.lat, lng: q.lng }, req.wctx.workspaceId) };
  });

  app.get('/api/locations/geocode', autocompleteLimit, async (req) => {
    requirePlaces();
    const q = parse(z.object({ address: z.string().trim().min(2).max(200) }), req.query);
    return { location: await places.geocodeAddress(q.address, req.wctx.workspaceId) };
  });

  app.post('/api/discovery/search', searchLimit, async (req) => {
    requirePlaces();
    const input = parse(discoverySearchSchema, req.body);
    return discovery.runDiscovery(req.wctx, input);
  });

  app.post('/api/discovery/verify-websites', searchLimit, async (req) => {
    const input = parse(z.object({ items: z.array(z.object({ placeId: z.string().min(1).max(300), url: z.string().min(3).max(500) })).min(1).max(40) }), req.body);
    return { results: await discovery.verifyWebsites(req.wctx, input.items) };
  });

  app.get('/api/discovery/place/:placeId', autocompleteLimit, async (req) => {
    requirePlaces();
    const { placeId } = parse(z.object({ placeId: z.string().min(1).max(300) }), req.params);
    const allowed = await discovery.authorizedPlaceIds(req.wctx, [placeId]);
    if (!allowed.has(placeId)) throw new AppError('NOT_FOUND', 'Business not found in your discovery results.');
    const q = parse(z.object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }), req.query);
    const place = await places.getPlaceDetails(placeId, { workspaceId: req.wctx.workspaceId });
    const center = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null;
    return { place: { ...place, ...places.analyzePlace(place, center) } };
  });

  /**
   * Live Google Maps summaries for saved prospects (names, addresses). Fetched
   * on demand for the rows currently on screen and never stored by Localy.
   */
  app.post('/api/places/summaries', autocompleteLimit, async (req) => {
    requirePlaces();
    const { placeIds } = parse(z.object({ placeIds: z.array(z.string().min(1).max(300)).min(1).max(50) }), req.body);
    const allowed = await discovery.authorizedPlaceIds(req.wctx, placeIds);
    const results = await places.getPlaceSummaries([...allowed], req.wctx.workspaceId);
    return {
      summaries: Object.fromEntries(
        results.map((r) => [
          r.placeId,
          r.place
            ? { name: r.place.name, address: r.place.address, shortAddress: r.place.shortAddress, locality: r.place.locality, category: r.place.category, businessStatus: r.place.businessStatus, googleMapsUri: r.place.googleMapsUri }
            : null,
        ]),
      ),
    };
  });

  app.get('/api/discovery/history', async (req) => ({ history: await discovery.listSearchHistory(req.wctx) }));

  app.delete('/api/discovery/history/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await discovery.deleteSearchHistory(req.wctx, id);
    return { ok: true };
  });

  app.delete('/api/discovery/history', async (req) => {
    await discovery.deleteSearchHistory(req.wctx);
    return { ok: true };
  });

  app.get('/api/saved-searches', async (req) => ({ savedSearches: await discovery.listSavedSearches(req.wctx) }));

  app.post('/api/saved-searches', async (req) => {
    const input = parse(savedSearchSchema, req.body);
    return { savedSearch: await discovery.createSavedSearch(req.wctx, input) };
  });

  app.put('/api/saved-searches/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(savedSearchSchema, req.body);
    return { savedSearch: await discovery.updateSavedSearch(req.wctx, id, input) };
  });

  app.delete('/api/saved-searches/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await discovery.deleteSavedSearch(req.wctx, id);
    return { ok: true };
  });
}
