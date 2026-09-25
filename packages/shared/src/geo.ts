const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Smallest lat/lng rectangle enclosing a circle. Used for Places locationRestriction. */
export function boundsForCircle(center: LatLng, radiusMeters: number) {
  const latDelta = toDeg(radiusMeters / EARTH_RADIUS_M);
  const cos = Math.max(0.000001, Math.cos(toRad(center.lat)));
  const lngDelta = toDeg(radiusMeters / (EARTH_RADIUS_M * cos));
  const clampLat = (v: number) => Math.max(-90, Math.min(90, v));
  const wrapLng = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
  return {
    low: { latitude: clampLat(center.lat - latDelta), longitude: wrapLng(center.lng - lngDelta) },
    high: { latitude: clampLat(center.lat + latDelta), longitude: wrapLng(center.lng + lngDelta) },
  };
}

export function formatDistance(meters: number, unit: 'km' | 'mi' = 'km'): string {
  if (unit === 'mi') {
    const miles = meters / 1609.344;
    return miles < 0.1 ? `${Math.round(meters * 3.28084)} ft` : `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatRadius(meters: number, unit: 'km' | 'mi' = 'km'): string {
  if (unit === 'mi') {
    const miles = meters / 1609.344;
    return `${miles < 10 ? Number(miles.toFixed(1)) : Math.round(miles)} mi`;
  }
  const km = meters / 1000;
  return `${km < 10 ? Number(km.toFixed(1)) : Math.round(km)} km`;
}
