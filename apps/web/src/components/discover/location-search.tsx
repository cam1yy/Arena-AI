import { useEffect, useRef, useState } from 'react';
import { Crosshair, MapPin, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import type { LocationValue } from '@localy/shared';
import { api, errorMessage, qs } from '@/lib/api';
import { cn, uuid } from '@/lib/utils';
import { Button, Spinner, Tooltip } from '@/components/ui';

interface Suggestion {
  placeId: string;
  primary: string;
  secondary: string | null;
  types: string[];
}

/**
 * Location search backed by Places Autocomplete (New) through the Localy API.
 * Uses session tokens so a typing session plus the final selection is billed
 * as a single autocomplete session.
 */
export function LocationSearch({ value, onChange, bias, placesEnabled, compact }: { value: LocationValue | null; onChange: (loc: LocationValue, suggestedRadius?: number | null) => void; bias?: { lat: number; lng: number } | null; placesEnabled: boolean; compact?: boolean }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [locating, setLocating] = useState(false);
  const session = useRef(uuid());
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = 'location-suggestions';

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !placesEnabled) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get<{ suggestions: Suggestion[] }>(`/api/locations/autocomplete${qs({ q, session: session.current, lat: bias?.lat, lng: bias?.lng })}`, { signal: ctrl.signal })
        .then((r) => {
          setItems(r.suggestions);
          setActive(0);
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') setItems([]);
        })
        .finally(() => setLoading(false));
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, placesEnabled, bias?.lat, bias?.lng]);

  const choose = async (s: Suggestion) => {
    setOpen(false);
    setResolving(true);
    try {
      const { location } = await api.get<{ location: { placeId: string; label: string; lat: number; lng: number; suggestedRadiusMeters: number | null } }>(`/api/locations/resolve${qs({ placeId: s.placeId, session: session.current })}`);
      onChange({ label: location.label, placeId: location.placeId, lat: location.lat, lng: location.lng, source: 'google', resolvedAt: new Date().toISOString() }, location.suggestedRadiusMeters);
      setQuery('');
      session.current = uuid();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setResolving(false);
    }
  };

  const geocodeTyped = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setResolving(true);
    try {
      const { location } = await api.get<{ location: { placeId: string | null; label: string; lat: number; lng: number } }>(`/api/locations/geocode${qs({ address: q })}`);
      onChange({ label: location.label, placeId: location.placeId, lat: location.lat, lng: location.lng, source: 'google', resolvedAt: new Date().toISOString() });
      setQuery('');
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setResolving(false);
    }
  };

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      toast.error('Your browser does not support location access.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        let label = 'Current location';
        if (placesEnabled) {
          try {
            const r = await api.get<{ location: { label: string } }>(`/api/locations/reverse${qs(point)}`);
            label = r.location.label;
          } catch {
            /* keep generic label */
          }
        }
        onChange({ label, placeId: null, lat: point.lat, lng: point.lng, source: 'device', resolvedAt: null });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        toast.error(err.code === err.PERMISSION_DENIED ? 'Location access was denied. Search for a place instead.' : 'Your location could not be determined.');
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) void choose(items[active]);
      else void geocodeTyped();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
            disabled={!placesEnabled}
            placeholder={placesEnabled ? 'Address, suburb, city or postcode' : 'Location search not configured'}
            className="h-9 w-full rounded-md border border-line bg-panel pl-9 pr-16 text-[13.5px] shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-subtle hover:border-line-strong focus:border-ink focus:ring-[3px] focus:ring-ink/8 disabled:bg-wash"
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && items[active] ? `loc-${items[active].placeId}` : undefined}
            aria-label="Search for a location"
          />
          <div className="absolute right-1 flex items-center gap-0.5">
            {(loading || resolving) && <Spinner className="mr-1 size-3.5 text-subtle" />}
            <Tooltip content="Use my current location">
              <Button variant="ghost" size="icon-sm" onClick={useMyLocation} loading={locating} aria-label="Use my current location">
                {!locating && <Crosshair />}
              </Button>
            </Tooltip>
          </div>
        </div>
        {open && items.length > 0 && (
          <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-line bg-panel p-1 shadow-md animate-scale-in">
            {items.map((s, i) => (
              <li
                key={s.placeId}
                id={`loc-${s.placeId}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void choose(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn('flex cursor-default items-start gap-2.5 rounded-md px-2.5 py-2', i === active && 'bg-hover')}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-subtle" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{s.primary}</span>
                  {s.secondary && <span className="block truncate text-[12px] text-muted">{s.secondary}</span>}
                </span>
              </li>
            ))}
            <li className="flex justify-end px-2 pb-1 pt-1.5">
              <span className="gmp-attribution" translate="no">
                Google Maps
              </span>
            </li>
          </ul>
        )}
      </div>
      {value && !compact && (
        <div className="flex items-start gap-2 rounded-md border border-line bg-wash/50 px-2.5 py-2">
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink" />
          <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-2">{value.label}</span>
          {value.source === 'pin' && <span className="shrink-0 text-[11px] text-subtle">Pin</span>}
        </div>
      )}
    </div>
  );
}

export function ClearButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="flex size-5 items-center justify-center rounded text-subtle hover:bg-hover hover:text-ink" aria-label={label}>
      <X className="size-3.5" />
    </button>
  );
}
