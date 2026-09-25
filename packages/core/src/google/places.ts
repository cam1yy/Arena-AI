import { getConfig } from '@localy/config';
import {
  boundsForCircle,
  classifyListedWebsite,
  computeSignals,
  haversineMeters,
  isOpportunity,
  type LatLng,
  type PlaceResult,
} from '@localy/shared';
import { AppError, ExternalServiceError, notConfigured } from '../errors';
import { externalFetch, RateLimiter, mapWithConcurrency } from '../http';
import { logger } from '../logger';

/*
 * Google Maps Platform client (Places API (New) and Geocoding API).
 *
 * All requests are made server-side with the server key, which never reaches
 * the browser. Responses are returned to the caller for display and are not
 * persisted, except for place IDs (which may be stored indefinitely) and, in
 * a few places, coordinates (which may be cached for up to 30 days and are
 * cleared by the maintenance job).
 */

export const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.addressComponents',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.rating',
  'places.userRatingCount',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.currentOpeningHours',
  'places.regularOpeningHours',
  'places.pureServiceAreaBusiness',
  'places.attributions',
  'nextPageToken',
].join(',');

/** Full details for a single business (prospect page, personalization at send time). */
export const DETAILS_FIELD_MASK = SEARCH_FIELD_MASK.split(',')
  .filter((f) => f.startsWith('places.'))
  .map((f) => f.slice('places.'.length))
  .join(',');

/** Lightweight summary for lists (Place Details Pro fields only). */
export const SUMMARY_FIELD_MASK = [
  'id',
  'displayName',
  'shortFormattedAddress',
  'formattedAddress',
  'addressComponents',
  'primaryType',
  'primaryTypeDisplayName',
  'businessStatus',
  'googleMapsUri',
].join(',');

const LOCATION_FIELD_MASK = 'id,displayName,formattedAddress,location,viewport,types';

interface GText {
  text?: string;
  languageCode?: string;
}
interface GPlace {
  id?: string;
  displayName?: GText;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  location?: { latitude?: number; longitude?: number };
  viewport?: { low?: { latitude: number; longitude: number }; high?: { latitude: number; longitude: number } };
  primaryType?: string;
  primaryTypeDisplayName?: GText;
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  businessStatus?: string;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  pureServiceAreaBusiness?: boolean;
  attributions?: { provider?: string; providerUri?: string }[];
}

const limiter = { instance: undefined as RateLimiter | undefined };
function rateLimiter() {
  limiter.instance ??= new RateLimiter(getConfig().PLACES_REQUESTS_PER_SECOND);
  return limiter.instance;
}

function serverKey(): string {
  const key = getConfig().GOOGLE_MAPS_API_KEY;
  if (!key) throw notConfigured('Google Places search', ['GOOGLE_MAPS_API_KEY']);
  return key;
}

function parseGoogleError(status: number, payload: unknown) {
  const err = (payload as { error?: { message?: string; status?: string } } | null)?.error;
  return { message: err?.message, code: err?.status ?? `HTTP_${status}` };
}

/** Translates provider failures into safe, human-readable application errors. */
export function toPlacesAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ExternalServiceError) {
    logger.warn({ service: err.service, status: err.httpStatus, code: err.providerCode, message: err.message }, 'google maps platform error');
    if (err.kind === 'quota' || err.providerCode === 'RESOURCE_EXHAUSTED') {
      return new AppError('EXTERNAL_QUOTA_EXCEEDED', 'Google Maps search is busy or its quota has been reached. Please try again in a few minutes.');
    }
    if (err.httpStatus === 403 || err.providerCode === 'PERMISSION_DENIED' || err.providerCode === 'REQUEST_DENIED') {
      return new AppError(
        'EXTERNAL_SERVICE_ERROR',
        'Google Maps rejected the request. An administrator should confirm that Places API (New) and the Geocoding API are enabled for the server key.',
      );
    }
    if (err.httpStatus === 400 || err.providerCode === 'INVALID_ARGUMENT') {
      return new AppError('BAD_REQUEST', 'Google Maps could not process this search. Try a simpler keyword or a different area.');
    }
    if (err.kind === 'not_found') return new AppError('NOT_FOUND', 'This place is no longer available on Google Maps.');
    return new AppError('EXTERNAL_SERVICE_ERROR', 'Google Maps is temporarily unavailable. Please try again shortly.');
  }
  return new AppError('EXTERNAL_SERVICE_ERROR', 'Google Maps is temporarily unavailable. Please try again shortly.');
}

async function placesRequest<T>(opts: {
  operation: string;
  path: string;
  method: 'GET' | 'POST';
  fieldMask?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  workspaceId?: string | null;
}): Promise<T> {
  const cfg = getConfig();
  const key = serverKey();
  await rateLimiter().acquire();
  const url = new URL(opts.path, cfg.GOOGLE_PLACES_BASE_URL);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v) url.searchParams.set(k, v);
  const headers: Record<string, string> = { 'X-Goog-Api-Key': key };
  if (opts.fieldMask) headers['X-Goog-FieldMask'] = opts.fieldMask;
  const res = await externalFetch<T>({
    service: 'places',
    operation: opts.operation,
    url: url.toString(),
    method: opts.method,
    headers,
    body: opts.body,
    timeoutMs: 12_000,
    retries: 2,
    workspaceId: opts.workspaceId,
    parseError: parseGoogleError,
  });
  return res.data;
}

function localityOf(p: GPlace): string | null {
  const comps = p.addressComponents ?? [];
  const pick = (type: string) => comps.find((c) => c.types?.includes(type))?.longText;
  return pick('sublocality_level_1') ?? pick('sublocality') ?? pick('locality') ?? pick('postal_town') ?? pick('administrative_area_level_2') ?? null;
}

export function normalizePlace(p: GPlace): PlaceResult {
  const hours = p.currentOpeningHours ?? p.regularOpeningHours;
  return {
    placeId: p.id ?? '',
    name: p.displayName?.text ?? null,
    primaryType: p.primaryType ?? null,
    category: p.primaryTypeDisplayName?.text ?? null,
    types: p.types ?? [],
    rating: typeof p.rating === 'number' ? p.rating : null,
    userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    address: p.formattedAddress ?? null,
    shortAddress: p.shortFormattedAddress ?? null,
    locality: localityOf(p),
    phone: p.nationalPhoneNumber ?? null,
    internationalPhone: p.internationalPhoneNumber ?? null,
    websiteUri: p.websiteUri ?? null,
    googleMapsUri: p.googleMapsUri ?? (p.id ? googleMapsUrlForPlaceId(p.id) : null),
    location:
      p.location && typeof p.location.latitude === 'number' && typeof p.location.longitude === 'number'
        ? { lat: p.location.latitude, lng: p.location.longitude }
        : null,
    businessStatus: p.businessStatus ?? null,
    openNow: typeof p.currentOpeningHours?.openNow === 'boolean' ? p.currentOpeningHours.openNow : null,
    weekdayHours: hours?.weekdayDescriptions ?? null,
    pureServiceArea: Boolean(p.pureServiceAreaBusiness),
    attributions: (p.attributions ?? []).filter((a) => a.provider).map((a) => ({ provider: a.provider!, providerUri: a.providerUri })),
  };
}

/** Google's documented URL format for opening a place by ID. Safe to build from a stored place ID. */
export function googleMapsUrlForPlaceId(placeId: string): string {
  return `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${encodeURIComponent(placeId)}`;
}

// ---------------------------------------------------------------------------
// Text Search
// ---------------------------------------------------------------------------

export interface TextSearchParams {
  query: string;
  center: LatLng;
  radiusMeters: number;
  pageToken?: string | null;
  minRating?: number | null;
  openNow?: boolean | null;
  workspaceId?: string | null;
}

export interface TextSearchPage {
  places: PlaceResult[];
  nextPageToken: string | null;
}

export async function textSearch(params: TextSearchParams): Promise<TextSearchPage> {
  const cfg = getConfig();
  // Text Search only supports rectangular restrictions. We restrict to the
  // circle's bounding box and filter by true distance afterwards.
  const body: Record<string, unknown> = {
    textQuery: params.query,
    pageSize: 20,
    languageCode: cfg.GOOGLE_PLACES_LANGUAGE,
    locationRestriction: { rectangle: boundsForCircle(params.center, params.radiusMeters) },
    includePureServiceAreaBusinesses: true,
  };
  if (cfg.GOOGLE_PLACES_REGION) body.regionCode = cfg.GOOGLE_PLACES_REGION;
  if (params.minRating) body.minRating = Math.min(5, Math.floor(params.minRating * 2) / 2);
  if (params.openNow) body.openNow = true;
  if (params.pageToken) body.pageToken = params.pageToken;
  try {
    const data = await placesRequest<{ places?: GPlace[]; nextPageToken?: string }>({
      operation: 'searchText',
      path: '/v1/places:searchText',
      method: 'POST',
      fieldMask: SEARCH_FIELD_MASK,
      body,
      workspaceId: params.workspaceId,
    });
    return { places: (data?.places ?? []).filter((p) => p.id).map(normalizePlace), nextPageToken: data?.nextPageToken ?? null };
  } catch (err) {
    throw toPlacesAppError(err);
  }
}

// ---------------------------------------------------------------------------
// Place Details
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<PlaceResult>>();

/**
 * Fetches live place details. Concurrent requests for the same place and
 * field mask share a single in-flight request; nothing is retained afterwards.
 */
export function getPlaceDetails(placeId: string, opts: { fieldMask?: string; workspaceId?: string | null; sessionToken?: string } = {}): Promise<PlaceResult> {
  const mask = opts.fieldMask ?? DETAILS_FIELD_MASK;
  const key = `${mask}|${placeId}|${opts.sessionToken ?? ''}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const data = await placesRequest<GPlace>({
        operation: mask === SUMMARY_FIELD_MASK ? 'placeSummary' : 'placeDetails',
        path: `/v1/places/${encodeURIComponent(placeId)}`,
        method: 'GET',
        fieldMask: mask,
        query: { languageCode: getConfig().GOOGLE_PLACES_LANGUAGE, sessionToken: opts.sessionToken },
        workspaceId: opts.workspaceId,
      });
      return normalizePlace(data);
    } catch (err) {
      throw toPlacesAppError(err);
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

export interface PlaceBatchItem {
  placeId: string;
  place: PlaceResult | null;
  error: string | null;
}

export async function getPlaceSummaries(placeIds: string[], workspaceId: string | null): Promise<PlaceBatchItem[]> {
  const unique = [...new Set(placeIds)].slice(0, 50);
  return mapWithConcurrency(unique, 6, async (placeId) => {
    try {
      return { placeId, place: await getPlaceDetails(placeId, { fieldMask: SUMMARY_FIELD_MASK, workspaceId }), error: null };
    } catch (err) {
      return { placeId, place: null, error: (err as Error).message };
    }
  });
}

// ---------------------------------------------------------------------------
// Location search (Autocomplete (New)) and geocoding
// ---------------------------------------------------------------------------

export interface LocationSuggestion {
  placeId: string;
  primary: string;
  secondary: string | null;
  types: string[];
}

export async function autocompleteLocations(input: string, opts: { sessionToken?: string; bias?: LatLng | null; workspaceId?: string | null }) {
  const cfg = getConfig();
  const body: Record<string, unknown> = { input, languageCode: cfg.GOOGLE_PLACES_LANGUAGE };
  if (opts.sessionToken) body.sessionToken = opts.sessionToken;
  if (opts.bias) body.locationBias = { circle: { center: { latitude: opts.bias.lat, longitude: opts.bias.lng }, radius: 50_000 } };
  if (cfg.GOOGLE_PLACES_REGION) body.regionCode = cfg.GOOGLE_PLACES_REGION;
  try {
    const data = await placesRequest<{
      suggestions?: {
        placePrediction?: {
          placeId?: string;
          text?: GText;
          structuredFormat?: { mainText?: GText; secondaryText?: GText };
          types?: string[];
        };
      }[];
    }>({ operation: 'autocomplete', path: '/v1/places:autocomplete', method: 'POST', body, workspaceId: opts.workspaceId });
    return (data?.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
      .map<LocationSuggestion>((p) => ({
        placeId: p.placeId!,
        primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondary: p.structuredFormat?.secondaryText?.text ?? null,
        types: p.types ?? [],
      }));
  } catch (err) {
    throw toPlacesAppError(err);
  }
}

export interface ResolvedLocation {
  placeId: string | null;
  label: string;
  lat: number;
  lng: number;
  suggestedRadiusMeters: number | null;
}

function radiusFromViewport(v: GPlace['viewport']): number | null {
  if (!v?.low || !v?.high) return null;
  const diag = haversineMeters({ lat: v.low.latitude, lng: v.low.longitude }, { lat: v.high.latitude, lng: v.high.longitude });
  return Math.round(diag / 2);
}

export async function resolveLocation(placeId: string, opts: { sessionToken?: string; workspaceId?: string | null } = {}): Promise<ResolvedLocation> {
  try {
    const data = await placesRequest<GPlace>({
      operation: 'placeLocation',
      path: `/v1/places/${encodeURIComponent(placeId)}`,
      method: 'GET',
      fieldMask: LOCATION_FIELD_MASK,
      query: { languageCode: getConfig().GOOGLE_PLACES_LANGUAGE, sessionToken: opts.sessionToken },
      workspaceId: opts.workspaceId,
    });
    if (typeof data?.location?.latitude !== 'number' || typeof data.location.longitude !== 'number') {
      throw new AppError('INVALID_ADDRESS', 'That location could not be found on the map. Try a different search.');
    }
    return {
      placeId: data.id ?? placeId,
      label: data.formattedAddress ?? data.displayName?.text ?? 'Selected location',
      lat: data.location.latitude,
      lng: data.location.longitude,
      suggestedRadiusMeters: radiusFromViewport(data.viewport),
    };
  } catch (err) {
    throw toPlacesAppError(err);
  }
}

interface GeocodeResponse {
  status: string;
  error_message?: string;
  results?: { formatted_address: string; place_id: string; geometry: { location: { lat: number; lng: number } }; types?: string[] }[];
}

async function geocodeRequest(operation: string, params: Record<string, string>, workspaceId?: string | null) {
  const cfg = getConfig();
  const url = new URL('/maps/api/geocode/json', cfg.GOOGLE_GEOCODING_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('language', cfg.GOOGLE_PLACES_LANGUAGE);
  url.searchParams.set('key', serverKey());
  await rateLimiter().acquire();
  let data: GeocodeResponse;
  try {
    data = (await externalFetch<GeocodeResponse>({ service: 'geocoding', operation, url: url.toString(), timeoutMs: 10_000, retries: 2, workspaceId })).data;
  } catch (err) {
    throw toPlacesAppError(err);
  }
  if (data.status === 'OK' || data.status === 'ZERO_RESULTS') return data.results ?? [];
  const kind = data.status === 'OVER_QUERY_LIMIT' || data.status === 'OVER_DAILY_LIMIT' ? 'quota' : data.status === 'UNKNOWN_ERROR' ? 'transient' : 'permanent';
  throw toPlacesAppError(new ExternalServiceError('geocoding', data.error_message ?? data.status, { providerCode: data.status, kind, httpStatus: data.status === 'REQUEST_DENIED' ? 403 : null }));
}

export async function reverseGeocode(point: LatLng, workspaceId?: string | null): Promise<{ label: string; placeId: string | null }> {
  const results = await geocodeRequest('reverse', { latlng: `${point.lat},${point.lng}` }, workspaceId);
  const preferred =
    results.find((r) => r.types?.some((t) => ['sublocality', 'neighborhood', 'locality', 'postal_code'].includes(t))) ?? results[0];
  if (!preferred) return { label: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`, placeId: null };
  return { label: preferred.formatted_address, placeId: preferred.place_id };
}

export async function geocodeAddress(address: string, workspaceId?: string | null): Promise<ResolvedLocation> {
  const results = await geocodeRequest('forward', { address }, workspaceId);
  const r = results[0];
  if (!r) throw new AppError('INVALID_ADDRESS', `We couldn't find "${address}". Check the spelling or try a nearby suburb, city or postcode.`);
  return { placeId: r.place_id, label: r.formatted_address, lat: r.geometry.location.lat, lng: r.geometry.location.lng, suggestedRadiusMeters: null };
}

// ---------------------------------------------------------------------------
// Result analysis
// ---------------------------------------------------------------------------

export function analyzePlace(place: PlaceResult, center: LatLng | null) {
  // websiteUri is always part of our field masks, so a missing value means the
  // listing does not include a website link.
  const site = classifyListedWebsite(place.websiteUri, true);
  const signals = computeSignals({
    websiteStatus: site.status,
    socialProfileOnly: site.socialProfileOnly,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    hasPhone: Boolean(place.phone || place.internationalPhone),
    businessStatus: place.businessStatus,
  });
  return {
    websiteStatus: site.status,
    socialProfileOnly: site.socialProfileOnly,
    signals,
    opportunity: isOpportunity(site.status, signals),
    distanceMeters: center && place.location ? Math.round(haversineMeters(center, place.location)) : null,
  };
}
