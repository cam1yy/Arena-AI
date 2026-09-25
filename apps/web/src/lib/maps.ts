import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

/*
 * Google Maps JavaScript API loader. Uses the browser key, which must be
 * restricted to your app's HTTP referrers in Google Cloud Console. The server
 * key used for Places API requests is never sent to the browser.
 */
let configuredKey: string | null = null;
let loading: Promise<typeof google.maps> | null = null;

export function loadGoogleMaps(key: string): Promise<typeof google.maps> {
  if (loading && configuredKey === key) return loading;
  configuredKey = key;
  setOptions({ key, v: 'weekly', language: navigator.language?.split('-')[0] || 'en' });
  loading = Promise.all([importLibrary('maps'), importLibrary('core')])
    .then(() => google.maps)
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}

/** Calm monochrome styling used when no cloud Map ID is configured. */
export const MONO_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f1f1ef' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#707070' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f7f7f5' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#d2d2cf' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8f8f8f' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e4e4e1' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#d6d6d3' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dde2e5' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9aa3a8' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#ebede8' }] },
];
