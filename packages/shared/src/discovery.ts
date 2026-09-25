import type { DiscoveryResult } from './types';
import type { DiscoveryFilters } from './schemas';

/**
 * Client- and server-shared result filtering. Searches return every business
 * found in the area; filters are applied locally so that changing a filter
 * never triggers another billable Google Maps request.
 */
export function passesFilters(r: DiscoveryResult, f: DiscoveryFilters): boolean {
  if (f.operationalOnly && r.businessStatus && r.businessStatus !== 'OPERATIONAL') return false;
  if (f.minRating != null && (r.rating ?? 0) < f.minRating) return false;
  if (f.maxRating != null && r.rating != null && r.rating > f.maxRating) return false;
  if (f.minReviews != null && (r.userRatingCount ?? 0) < f.minReviews) return false;
  if (f.openNow && r.openNow !== true) return false;
  if (f.phone === 'has' && !r.phone && !r.internationalPhone) return false;
  if (f.phone === 'none' && (r.phone || r.internationalPhone)) return false;
  switch (f.website) {
    case 'opportunity':
      return r.opportunity;
    case 'not_listed':
      return r.websiteStatus === 'not_listed';
    case 'listed':
      return r.websiteStatus === 'listed' || r.websiteStatus === 'detected';
    case 'unknown':
      return r.websiteStatus === 'unknown';
    default:
      return true;
  }
}

export const DISCOVERY_SORTS = ['distance', 'rating', 'reviews', 'signals', 'name'] as const;
export type DiscoverySort = (typeof DISCOVERY_SORTS)[number];

export function sortResults<T extends DiscoveryResult>(list: T[], sort: DiscoverySort): T[] {
  const copy = [...list];
  const signalCount = (r: T) => Object.values(r.signals).filter(Boolean).length;
  switch (sort) {
    case 'rating':
      return copy.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0));
    case 'reviews':
      return copy.sort((a, b) => (b.userRatingCount ?? -1) - (a.userRatingCount ?? -1));
    case 'signals':
      return copy.sort((a, b) => signalCount(b) - signalCount(a) || (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
    case 'name':
      return copy.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    default:
      return copy.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  }
}
