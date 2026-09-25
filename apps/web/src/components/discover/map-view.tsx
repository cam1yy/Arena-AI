import { useEffect, useRef, useState } from 'react';
import { MapPin, MapPinOff } from 'lucide-react';
import { MAX_RADIUS_METERS, MIN_RADIUS_METERS, type LatLng } from '@localy/shared';
import { loadGoogleMaps, MONO_STYLES } from '@/lib/maps';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui';

export interface MapBusiness {
  placeId: string;
  name: string | null;
  location: LatLng | null;
  opportunity: boolean;
}

interface MarkerHandle {
  overlay: google.maps.OverlayView;
  el: HTMLButtonElement;
  setState: (s: { selected: boolean; hovered: boolean }) => void;
}

/**
 * Creates an HTML marker as a custom OverlayView. Works with or without a
 * cloud Map ID and keeps markers keyboard focusable.
 */
function createHtmlMarker(g: typeof google.maps, map: google.maps.Map, position: LatLng, label: string, opportunity: boolean, onClick: () => void, onHover: (h: boolean) => void): MarkerHandle {
  const el = document.createElement('button');
  el.type = 'button';
  el.setAttribute('aria-label', label);
  el.title = label;
  el.style.cssText =
    'position:absolute;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:9999px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:transform 140ms ease, background-color 140ms ease, box-shadow 140ms ease;box-shadow:0 2px 6px rgba(0,0,0,0.25);';
  const dot = document.createElement('span');
  dot.style.cssText = 'width:6px;height:6px;border-radius:9999px;background:#fff;';
  el.appendChild(dot);
  const paint = (s: { selected: boolean; hovered: boolean }) => {
    el.style.background = opportunity ? '#0a0a0a' : '#8f8f8f';
    el.style.transform = `translate(-50%,-50%) scale(${s.selected ? 1.35 : s.hovered ? 1.18 : 1})`;
    el.style.zIndex = s.selected ? '30' : s.hovered ? '20' : '10';
    el.style.boxShadow = s.selected ? '0 0 0 4px rgba(10,10,10,0.18), 0 4px 10px rgba(0,0,0,0.3)' : '0 2px 6px rgba(0,0,0,0.25)';
  };
  paint({ selected: false, hovered: false });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  el.addEventListener('mouseenter', () => onHover(true));
  el.addEventListener('mouseleave', () => onHover(false));
  el.addEventListener('focus', () => onHover(true));
  el.addEventListener('blur', () => onHover(false));

  class Overlay extends g.OverlayView {
    override onAdd() {
      this.getPanes()?.overlayMouseTarget.appendChild(el);
    }
    override draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(new g.LatLng(position.lat, position.lng));
      if (p) {
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
      }
    }
    override onRemove() {
      el.remove();
    }
  }
  const overlay = new Overlay();
  overlay.setMap(map);
  return { overlay, el, setState: paint };
}

export function MapView({
  center,
  radiusMeters,
  businesses,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  onCenterChange,
  onRadiusChange,
  searching,
  className,
}: {
  center: LatLng | null;
  radiusMeters: number;
  businesses: MapBusiness[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (placeId: string) => void;
  onHover: (placeId: string | null) => void;
  onCenterChange: (p: LatLng) => void;
  onRadiusChange: (m: number) => void;
  searching?: boolean;
  className?: string;
}) {
  const { config } = useSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const gRef = useRef<typeof google.maps | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const pinRef = useRef<google.maps.OverlayView | null>(null);
  const pinPosRef = useRef<LatLng | null>(null);
  const markersRef = useRef<Map<string, MarkerHandle>>(new Map());
  const programmatic = useRef(false);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbRef = useRef({ onSelect, onHover, onCenterChange, onRadiusChange });
  cbRef.current = { onSelect, onHover, onCenterChange, onRadiusChange };
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'unconfigured'>(config?.mapsBrowserKey ? 'loading' : 'unconfigured');

  // Load the Maps JavaScript API and create the map once.
  useEffect(() => {
    const key = config?.mapsBrowserKey;
    if (!key) {
      setStatus('unconfigured');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    loadGoogleMaps(key)
      .then((g) => {
        if (cancelled || !containerRef.current) return;
        gRef.current = g;
        const map = new g.Map(containerRef.current, {
          center: center ?? { lat: 20, lng: 0 },
          zoom: center ? 12 : 2,
          mapId: config?.mapsMapId ?? undefined,
          styles: config?.mapsMapId ? undefined : MONO_STYLES,
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
          keyboardShortcuts: true,
        });
        mapRef.current = map;
        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          cbRef.current.onCenterChange({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        const circle = new g.Circle({
          map,
          center: center ?? { lat: 0, lng: 0 },
          radius: radiusMeters,
          visible: Boolean(center),
          editable: true,
          draggable: false,
          strokeColor: '#0a0a0a',
          strokeOpacity: 0.55,
          strokeWeight: 1.5,
          fillColor: '#0a0a0a',
          fillOpacity: 0.045,
          clickable: false,
        });
        circleRef.current = circle;
        const scheduleCommit = (fn: () => void) => {
          if (commitTimer.current) clearTimeout(commitTimer.current);
          commitTimer.current = setTimeout(fn, 350);
        };
        circle.addListener('center_changed', () => {
          const c = circle.getCenter();
          if (!c) return;
          pinPosRef.current = { lat: c.lat(), lng: c.lng() };
          pinRef.current?.draw();
          if (programmatic.current) return;
          scheduleCommit(() => cbRef.current.onCenterChange({ lat: c.lat(), lng: c.lng() }));
        });
        circle.addListener('radius_changed', () => {
          if (programmatic.current) return;
          const r = Math.round(Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, circle.getRadius())));
          if (Math.abs(r - circle.getRadius()) > 1) {
            programmatic.current = true;
            circle.setRadius(r);
            programmatic.current = false;
          }
          scheduleCommit(() => cbRef.current.onRadiusChange(r));
        });
        // Center pin (visual only; drag the circle's center handle to move it).
        const pinEl = document.createElement('div');
        pinEl.setAttribute('aria-hidden', 'true');
        pinEl.style.cssText = 'position:absolute;transform:translate(-50%,-100%);pointer-events:none;';
        pinEl.innerHTML =
          '<svg width="30" height="38" viewBox="0 0 30 38" fill="none"><path d="M15 37s12-12.2 12-22A12 12 0 0 0 3 15c0 9.8 12 22 12 22z" fill="#0a0a0a"/><circle cx="15" cy="15" r="4.5" fill="#fff"/></svg>';
        class Pin extends g.OverlayView {
          override onAdd() {
            this.getPanes()?.floatPane.appendChild(pinEl);
          }
          override draw() {
            const pos = pinPosRef.current;
            const p = pos ? this.getProjection()?.fromLatLngToDivPixel(new g.LatLng(pos.lat, pos.lng)) : null;
            if (p) {
              pinEl.style.display = 'block';
              pinEl.style.left = `${p.x}px`;
              pinEl.style.top = `${p.y - 4}px`;
            } else pinEl.style.display = 'none';
          }
          override onRemove() {
            pinEl.remove();
          }
        }
        pinPosRef.current = center;
        const pin = new Pin();
        pin.setMap(map);
        pinRef.current = pin;
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // The map is created once per key; later prop changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.mapsBrowserKey, config?.mapsMapId]);

  // Sync the search area.
  useEffect(() => {
    const map = mapRef.current;
    const circle = circleRef.current;
    const g = gRef.current;
    if (!map || !circle || !g || status !== 'ready') return;
    programmatic.current = true;
    if (center) {
      circle.setCenter(center);
      circle.setRadius(radiusMeters);
      circle.setVisible(true);
      pinPosRef.current = center;
      pinRef.current?.draw();
      const b = circle.getBounds();
      if (b) map.fitBounds(b, 24);
    } else {
      circle.setVisible(false);
      pinPosRef.current = null;
      pinRef.current?.draw();
    }
    programmatic.current = false;
  }, [center?.lat, center?.lng, radiusMeters, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync business markers.
  useEffect(() => {
    const map = mapRef.current;
    const g = gRef.current;
    if (!map || !g || status !== 'ready') return;
    const existing = markersRef.current;
    const next = new Set(businesses.filter((b) => b.location).map((b) => b.placeId));
    for (const [id, m] of existing) {
      if (!next.has(id)) {
        m.overlay.setMap(null);
        existing.delete(id);
      }
    }
    for (const b of businesses) {
      if (!b.location || existing.has(b.placeId)) continue;
      existing.set(
        b.placeId,
        createHtmlMarker(g, map, b.location, b.name ?? 'Business', b.opportunity, () => cbRef.current.onSelect(b.placeId), (h) => cbRef.current.onHover(h ? b.placeId : null)),
      );
    }
  }, [businesses, status]);

  // Highlight selected / hovered markers and bring the selection into view.
  useEffect(() => {
    for (const [id, m] of markersRef.current) m.setState({ selected: id === selectedId, hovered: id === hoveredId });
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const b = businesses.find((x) => x.placeId === selectedId);
    if (b?.location) {
      const bounds = map.getBounds();
      if (!bounds || !bounds.contains(b.location)) map.panTo(b.location);
    }
  }, [selectedId, hoveredId, businesses]);

  useEffect(
    () => () => {
      for (const m of markersRef.current.values()) m.overlay.setMap(null);
      markersRef.current.clear();
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    [],
  );

  return (
    <div className={cn('relative h-full min-h-[280px] w-full overflow-hidden bg-[#eeeeec]', className)}>
      <div ref={containerRef} className="absolute inset-0" role="application" aria-label="Map of the search area. Click the map to move the search pin." />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#eeeeec]">
          <div className="skeleton absolute inset-0 !rounded-none opacity-60" />
          <span className="relative flex items-center gap-2 rounded-md bg-panel/90 px-3 py-1.5 text-[12.5px] text-muted shadow-sm">
            <Spinner className="size-3.5" /> Loading map
          </span>
        </div>
      )}
      {(status === 'unconfigured' || status === 'error') && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#f1f1ef] p-6">
          <div className="max-w-[340px] text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-line bg-panel text-muted shadow-xs">
              {status === 'error' ? <MapPinOff className="size-[18px]" /> : <MapPin className="size-[18px]" />}
            </div>
            <p className="mt-3 text-[13.5px] font-medium text-ink">{status === 'error' ? 'The map could not be loaded' : 'Interactive map not configured'}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              {status === 'error'
                ? 'Google Maps did not load. Check your connection or the browser key restrictions. Search and results still work.'
                : 'Set GOOGLE_MAPS_BROWSER_KEY (Maps JavaScript API, referrer-restricted) to show the map. You can still search by location and review results in the list.'}
            </p>
          </div>
        </div>
      )}
      {searching && status === 'ready' && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 animate-fade-in">
          <span className="flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-white shadow-md">
            <Spinner className="size-3.5" /> Searching this area
          </span>
        </div>
      )}
      {status === 'ready' && center && (
        <div className="pointer-events-none absolute bottom-3 left-3 hidden rounded-md bg-panel/90 px-2.5 py-1.5 text-[11.5px] text-muted shadow-sm md:block">Click the map or drag the circle to adjust the area</div>
      )}
    </div>
  );
}
