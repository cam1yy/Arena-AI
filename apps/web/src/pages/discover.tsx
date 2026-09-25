import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  Clock,
  ExternalLink,
  Globe,
  History,
  Info,
  ListFilter,
  Map as MapIcon,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  BUSINESS_CATEGORIES,
  GOOGLE_MAPS_RANKING_EXPLAINER,
  GOOGLE_MAPS_RANKING_URL,
  RADIUS_PRESETS_KM,
  MAX_RADIUS_METERS,
  MIN_RADIUS_METERS,
  WEBSITE_FILTER_LABELS,
  WEBSITE_FILTERS,
  categoryLabel,
  formatRadius,
  passesFilters,
  sortResults,
  type DiscoveryFilters,
  type DiscoveryResponse,
  type DiscoveryResult,
  type DiscoverySort,
  type LocationValue,
  type SavedSearchItem,
  type SearchHistoryItem,
  type WebsiteFilter,
} from '@localy/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useMe, useSession } from '@/lib/session';
import { cn, formatNumber, pluralize, timeAgo } from '@/lib/utils';
import { Button, Checkbox, Dialog, Drawer, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Notice, Popover, PopoverContent, PopoverTrigger, SegmentedControl, Select, Skeleton, Switch, Tooltip } from '@/components/ui';
import { MapView } from '@/components/discover/map-view';
import { LocationSearch } from '@/components/discover/location-search';
import { BusinessCard } from '@/components/discover/business-card';
import { SignalList } from '@/components/discover/signals';
import { WebsiteStatusBadge } from '@/components/app/status';

interface SearchState {
  location: LocationValue | null;
  radiusMeters: number;
  categories: string[];
  keyword: string;
  filters: DiscoveryFilters;
}

const DEFAULT_FILTERS: DiscoveryFilters = { website: 'opportunity', phone: 'any', operationalOnly: true, minRating: null, maxRating: null, minReviews: null, openNow: null };

function CategoryPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = BUSINESS_CATEGORIES.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(filtered.map((c) => c.group))];
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : value.length >= 5 ? value : [...value, id]);
  const custom = q.trim();
  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="flex h-9 w-full items-center justify-between rounded-md border border-line bg-panel px-3 text-left text-[13.5px] shadow-xs hover:border-line-strong" aria-label="Choose business categories">
            <span className={cn(value.length ? 'text-ink' : 'text-subtle')}>{value.length ? `${value.length} selected` : 'Choose categories'}</span>
            <ChevronDown className="size-4 text-subtle" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <div className="border-b border-line p-2">
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search or type your own"
              leftIcon={<Search />}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom && !filtered.length) {
                  toggle(custom);
                  setQ('');
                }
              }}
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1">
            {custom && !BUSINESS_CATEGORIES.some((c) => c.label.toLowerCase() === custom.toLowerCase()) && (
              <button
                type="button"
                onClick={() => {
                  toggle(custom);
                  setQ('');
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover"
              >
                <Plus className="size-4 text-muted" /> Search for "{custom}"
              </button>
            )}
            {groups.map((g) => (
              <div key={g}>
                <div className="px-2 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-wider text-subtle">{g}</div>
                {filtered
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <label key={c.id} className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] hover:bg-hover">
                      <Checkbox checked={value.includes(c.id)} onCheckedChange={() => toggle(c.id)} label={c.label} disabled={!value.includes(c.id) && value.length >= 5} />
                      {c.label}
                    </label>
                  ))}
              </div>
            ))}
          </div>
          <div className="border-t border-line px-3 py-2 text-[11.5px] text-muted">Up to 5 categories per search. Each category uses one map search request.</div>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((v) => (
            <span key={v} className="inline-flex h-6 items-center gap-1 rounded-[5px] border border-line bg-panel pl-2 pr-1 text-[12px]">
              {categoryLabel(v)}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="flex size-4 items-center justify-center rounded text-subtle hover:bg-hover hover:text-ink" aria-label={`Remove ${categoryLabel(v)}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RadiusControl({ value, onChange, unit }: { value: number; onChange: (m: number) => void; unit: 'km' | 'mi' }) {
  const preset = RADIUS_PRESETS_KM.find((k) => k * 1000 === value);
  const [custom, setCustom] = useState(!preset);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1">
        {RADIUS_PRESETS_KM.map((km) => (
          <button
            key={km}
            type="button"
            onClick={() => {
              setCustom(false);
              onChange(km * 1000);
            }}
            className={cn('h-8 rounded-md border text-[12.5px] font-medium transition-colors', !custom && value === km * 1000 ? 'border-ink bg-ink text-white' : 'border-line bg-panel text-ink-2 hover:border-line-strong')}
            aria-pressed={!custom && value === km * 1000}
          >
            {km} km
          </button>
        ))}
        <button type="button" onClick={() => setCustom(true)} className={cn('h-8 rounded-md border text-[12.5px] font-medium transition-colors', custom ? 'border-ink bg-ink text-white' : 'border-line bg-panel text-ink-2 hover:border-line-strong')} aria-pressed={custom}>
          Custom
        </button>
      </div>
      {custom && (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={MIN_RADIUS_METERS}
            max={MAX_RADIUS_METERS}
            step={500}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-line accent-ink"
            aria-label="Search radius"
          />
          <span className="tabular w-14 text-right text-[12.5px] font-medium">{formatRadius(value, unit)}</span>
        </div>
      )}
    </div>
  );
}

function FiltersPanel({ filters, onChange }: { filters: DiscoveryFilters; onChange: (f: DiscoveryFilters) => void }) {
  const set = <K extends keyof DiscoveryFilters>(k: K, v: DiscoveryFilters[K]) => onChange({ ...filters, [k]: v });
  return (
    <div className="space-y-4">
      <Field label="Website" htmlFor="f-website">
        <Select id="f-website" value={filters.website} onChange={(e) => set('website', e.target.value as WebsiteFilter)}>
          {WEBSITE_FILTERS.map((w) => (
            <option key={w} value={w}>
              {WEBSITE_FILTER_LABELS[w]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Min rating" htmlFor="f-min">
          <Select id="f-min" value={filters.minRating ?? ''} onChange={(e) => set('minRating', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Any</option>
            {[3, 3.5, 4, 4.5].map((r) => (
              <option key={r} value={r}>
                {r}+
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Max rating" htmlFor="f-max">
          <Select id="f-max" value={filters.maxRating ?? ''} onChange={(e) => set('maxRating', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Any</option>
            {[3, 3.5, 4, 4.5].map((r) => (
              <option key={r} value={r}>
                {r} or lower
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Minimum reviews" htmlFor="f-reviews">
        <Select id="f-reviews" value={filters.minReviews ?? ''} onChange={(e) => set('minReviews', e.target.value ? Number(e.target.value) : null)}>
          <option value="">Any</option>
          {[5, 10, 25, 50, 100, 250].map((r) => (
            <option key={r} value={r}>
              {r}+
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Phone number" htmlFor="f-phone">
        <Select id="f-phone" value={filters.phone} onChange={(e) => set('phone', e.target.value as DiscoveryFilters['phone'])}>
          <option value="any">Any</option>
          <option value="has">Phone listed</option>
          <option value="none">No phone listed</option>
        </Select>
      </Field>
      <div className="space-y-2.5 pt-1">
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>Open now</span>
          <Switch checked={Boolean(filters.openNow)} onCheckedChange={(v) => set('openNow', v || null)} label="Open now" />
        </label>
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span>Hide closed businesses</span>
          <Switch checked={filters.operationalOnly} onCheckedChange={(v) => set('operationalOnly', v)} label="Hide closed businesses" />
        </label>
      </div>
      <Tooltip content="Google Maps does not provide email addresses. You add contact emails yourself after saving a prospect.">
        <p className="flex cursor-help items-center gap-1.5 text-[12px] text-muted">
          <Info className="size-3.5" /> Why is there no email filter?
        </p>
      </Tooltip>
    </div>
  );
}

function DetailsDrawer({ result, onClose, onSave, saving, unit }: { result: DiscoveryResult | null; onClose: () => void; onSave: () => void; saving: boolean; unit: 'km' | 'mi' }) {
  return (
    <Drawer
      open={Boolean(result)}
      onOpenChange={(o) => !o && onClose()}
      title={result?.name ?? 'Business'}
      description={result?.category ?? undefined}
      footer={
        result &&
        (result.prospectId ? (
          <Button variant="primary" asChild>
            <Link to={`/app/prospects/${result.prospectId}`}>Open prospect</Link>
          </Button>
        ) : (
          <Button variant="primary" loading={saving} leftIcon={<Plus />} onClick={onSave}>
            Add prospect
          </Button>
        ))
      }
    >
      {result && (
        <div className="space-y-6">
          <div className="rounded-lg border border-line">
            <dl className="divide-y divide-line text-[13px]">
              {[
                ['Address', result.address],
                ['Phone', result.internationalPhone ?? result.phone],
                ['Rating', result.rating !== null ? `${result.rating.toFixed(1)} from ${formatNumber(result.userRatingCount ?? 0)} reviews` : null],
                ['Distance', result.distanceMeters !== null ? `${(unit === 'mi' ? result.distanceMeters / 1609.344 : result.distanceMeters / 1000).toFixed(1)} ${unit} from the search pin` : null],
                ['Status', result.businessStatus ? result.businessStatus.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[100px_1fr] gap-3 px-3.5 py-2.5">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-ink">{v}</dd>
                  </div>
                ))}
              <div className="grid grid-cols-[100px_1fr] gap-3 px-3.5 py-2.5">
                <dt className="text-muted">Website</dt>
                <dd className="space-y-1.5">
                  <WebsiteStatusBadge status={result.websiteCheck?.status ?? result.websiteStatus} socialOnly={result.socialProfileOnly} />
                  {result.websiteUri && (
                    <a href={result.websiteUri} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 break-all text-[12.5px] text-ink-2 underline-offset-2 hover:underline">
                      <Globe className="size-3 shrink-0" /> {result.websiteUri}
                    </a>
                  )}
                </dd>
              </div>
            </dl>
            <div className="flex items-center justify-between border-t border-line px-3.5 py-2">
              {result.googleMapsUri ? (
                <a href={result.googleMapsUri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink hover:underline">
                  Open in Google Maps <ExternalLink className="size-3" />
                </a>
              ) : (
                <span />
              )}
              <span className="gmp-attribution" translate="no">
                Google Maps
              </span>
            </div>
          </div>
          {result.weekdayHours && (
            <div>
              <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-subtle">Opening hours</h4>
              <ul className="space-y-1 text-[12.5px] text-ink-2">
                {result.weekdayHours.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4 className="mb-2.5 text-[12px] font-medium uppercase tracking-wider text-subtle">Opportunity signals</h4>
            <SignalList signals={result.signals} />
            <p className="mt-3 text-[11.5px] leading-relaxed text-subtle">Signals are facts from the listing, not predictions. Use them to decide who to contact first.</p>
          </div>
          {result.attributions.length > 0 && (
            <p className="text-[11.5px] text-subtle">
              Data providers:{' '}
              {result.attributions.map((a, i) => (
                <span key={a.provider}>
                  {i > 0 && ', '}
                  {a.providerUri ? (
                    <a href={a.providerUri} target="_blank" rel="noopener noreferrer" className="underline">
                      {a.provider}
                    </a>
                  ) : (
                    a.provider
                  )}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}

export default function Discover() {
  const me = useMe();
  const { config } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const settings = me.workspace.settings;
  const unit = me.user.distanceUnit;
  const placesEnabled = Boolean(config?.features.places);

  const [state, setState] = useState<SearchState>(() => ({
    location: settings.defaultLocation,
    radiusMeters: settings.defaultRadiusMeters,
    categories: settings.defaultCategories.slice(0, 5),
    keyword: '',
    filters: { ...DEFAULT_FILTERS, website: settings.websiteFilter, minRating: settings.minRating, maxRating: settings.maxRating },
  }));
  const [response, setResponse] = useState<DiscoveryResponse | null>(null);
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [sort, setSort] = useState<DiscoverySort>('distance');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [saveSearchOpen, setSaveSearchOpen] = useState(false);
  const [savedSearchId, setSavedSearchId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [filtersOpenMobile, setFiltersOpenMobile] = useState(false);
  const [rankingInfo, setRankingInfo] = useState(false);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  const history = useApi<{ history: SearchHistoryItem[] }>(['discovery-history'], '/api/discovery/history');
  const saved = useApi<{ savedSearches: SavedSearchItem[] }>(['saved-searches'], '/api/saved-searches');

  const visible = useMemo(() => sortResults(results.filter((r) => passesFilters(r, state.filters)), sort), [results, state.filters, sort]);
  const opportunities = results.filter((r) => r.opportunity).length;

  const run = useCallback(
    async (overrides?: Partial<SearchState> & { savedSearchId?: string | null }) => {
      const s = { ...state, ...overrides };
      if (!s.location) {
        toast.error('Choose a location first.');
        return;
      }
      if (!s.categories.length && !s.keyword.trim()) {
        toast.error('Choose at least one category or enter a keyword.');
        return;
      }
      setSearching(true);
      setError(null);
      setSelectedIds(new Set());
      setActiveId(null);
      try {
        const res = await api.post<DiscoveryResponse>('/api/discovery/search', {
          categories: s.categories,
          keyword: s.keyword.trim() || null,
          location: s.location,
          radiusMeters: s.radiusMeters,
          filters: s.filters,
          savedSearchId: overrides?.savedSearchId ?? null,
        });
        setResponse(res);
        setResults(res.results);
        setMobileView('list');
        if (res.limitNotice) toast.warning(res.limitNotice);
        else if (res.usage.discovered.warning) toast.warning("You're approaching your monthly discovery limit.", { action: { label: 'View plans', onClick: () => navigate('/app/billing') } });
        void qc.invalidateQueries({ queryKey: ['discovery-history'] });
      } catch (e) {
        setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', errorMessage(e)));
      } finally {
        setSearching(false);
      }
    },
    [state, qc, navigate],
  );

  const loadMore = async () => {
    if (!response?.hasMore) return;
    setLoadingMore(true);
    try {
      const res = await api.post<DiscoveryResponse>('/api/discovery/search', {
        categories: state.categories,
        keyword: state.keyword.trim() || null,
        location: state.location,
        radiusMeters: state.radiusMeters,
        filters: state.filters,
        pageTokens: response.pageTokens,
        searchId: response.searchId,
      });
      setResponse({ ...res, searchId: response.searchId });
      setResults((prev) => {
        const seen = new Set(prev.map((p) => p.placeId));
        return [...prev, ...res.results.filter((r) => !seen.has(r.placeId))];
      });
      if (res.limitNotice) toast.warning(res.limitNotice);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  };

  // Open a saved search or history entry from the URL.
  useEffect(() => {
    const savedId = params.get('saved');
    const historyId = params.get('history');
    if (savedId && saved.data) {
      const s = saved.data.savedSearches.find((x) => x.id === savedId);
      if (s) {
        const next = { location: s.config.location, radiusMeters: s.config.radiusMeters, categories: s.config.categories, keyword: s.config.keyword ?? '', filters: { ...DEFAULT_FILTERS, ...s.config.filters } };
        setState(next);
        setSavedSearchId(s.id);
        setParams({}, { replace: true });
        void run({ ...next, savedSearchId: s.id });
      }
    } else if (historyId && history.data) {
      const h = history.data.history.find((x) => x.id === historyId);
      if (h) {
        setState({ location: h.location, radiusMeters: h.radiusMeters, categories: h.categories, keyword: h.keyword ?? '', filters: { ...DEFAULT_FILTERS, ...h.filters } });
        setParams({}, { replace: true });
      }
    }
  }, [params, saved.data, history.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProspects = async (list: DiscoveryResult[]) => {
    const toSave = list.filter((r) => !r.prospectId);
    if (!toSave.length) return;
    setSavingIds((s) => new Set([...s, ...toSave.map((r) => r.placeId)]));
    try {
      const res = await api.post<{ created: { id: string; placeId: string }[]; alreadySaved: { id: string; placeId: string }[] }>('/api/prospects/from-discovery', {
        searchId: response?.searchId ?? null,
        businesses: toSave.map((r) => ({ placeId: r.placeId, websiteStatus: r.websiteCheck?.status ?? r.websiteStatus, socialProfileOnly: r.socialProfileOnly, signals: r.signals })),
      });
      const map = new Map([...res.created, ...res.alreadySaved].map((c) => [c.placeId, c.id]));
      setResults((prev) => prev.map((r) => (map.has(r.placeId) ? { ...r, prospectId: map.get(r.placeId)! } : r)));
      setSelectedIds(new Set());
      void qc.invalidateQueries({ queryKey: ['prospects'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(res.created.length === 1 ? 'Saved as a prospect' : `${pluralize(res.created.length, 'prospect')} saved`, {
        action: { label: 'View', onClick: () => navigate(res.created.length === 1 ? `/app/prospects/${res.created[0].id}` : '/app/prospects') },
      });
    } catch (e) {
      const err = e as ApiError;
      toast.error(errorMessage(e), err.code === 'LIMIT_REACHED' ? { action: { label: 'Upgrade', onClick: () => navigate('/app/billing') } } : undefined);
    } finally {
      setSavingIds((s) => {
        const n = new Set(s);
        toSave.forEach((r) => n.delete(r.placeId));
        return n;
      });
    }
  };

  const checkWebsites = async () => {
    const targets = visible.filter((r) => r.websiteUri && !r.websiteCheck).slice(0, 40);
    if (!targets.length) {
      toast.message('There are no unchecked listed websites in these results.');
      return;
    }
    setChecking(true);
    try {
      const res = await api.post<{ results: { placeId: string; status: 'detected' | 'unavailable'; httpStatus: number | null; checkedAt: string; reason: string }[] }>('/api/discovery/verify-websites', {
        items: targets.map((t) => ({ placeId: t.placeId, url: t.websiteUri! })),
      });
      const byId = new Map(res.results.map((r) => [r.placeId, r]));
      setResults((prev) =>
        prev.map((r) => {
          const c = byId.get(r.placeId);
          if (!c) return r;
          const signals = { ...r.signals, websiteUnavailable: c.status === 'unavailable' };
          return { ...r, websiteCheck: { status: c.status, httpStatus: c.httpStatus, checkedAt: c.checkedAt }, signals, opportunity: r.opportunity || c.status === 'unavailable' };
        }),
      );
      const down = res.results.filter((r) => r.status === 'unavailable').length;
      toast.success(`Checked ${pluralize(res.results.length, 'website')}. ${down ? `${down} did not respond.` : 'All responded.'}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const activate = (id: string, scroll = false) => {
    setActiveId(id);
    if (scroll) cardRefs.current.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const selectableVisible = visible.filter((r) => !r.prospectId);
  const allSelected = selectableVisible.length > 0 && selectableVisible.every((r) => selectedIds.has(r.placeId));
  const detailsResult = results.find((r) => r.placeId === detailsId) ?? null;
  const center = state.location?.lat != null && state.location?.lng != null ? { lat: state.location.lat, lng: state.location.lng } : null;

  const controls = (
    <div className="space-y-5">
      <Field label="Location">
        <LocationSearch
          value={state.location}
          placesEnabled={placesEnabled}
          bias={center}
          onChange={(loc, suggested) =>
            setState((s) => ({ ...s, location: loc, radiusMeters: suggested && suggested >= 2000 && suggested <= MAX_RADIUS_METERS ? Math.round(Math.min(suggested, 25_000) / 1000) * 1000 : s.radiusMeters }))
          }
        />
      </Field>
      <Field label="Search radius">
        <RadiusControl value={state.radiusMeters} onChange={(m) => setState((s) => ({ ...s, radiusMeters: m }))} unit={unit} />
      </Field>
      <Field label="Business categories">
        <CategoryPicker value={state.categories} onChange={(c) => setState((s) => ({ ...s, categories: c }))} />
      </Field>
      <Field label="Keyword" htmlFor="kw" optional>
        <Input id="kw" value={state.keyword} onChange={(e) => setState((s) => ({ ...s, keyword: e.target.value }))} placeholder="For example: mobile, vegan, emergency" onKeyDown={(e) => e.key === 'Enter' && run()} />
      </Field>
      <Button variant="primary" size="lg" className="w-full" loading={searching} leftIcon={<Search />} onClick={() => run()} disabled={!placesEnabled}>
        Discover businesses
      </Button>
      {state.categories.length + (state.keyword.trim() && !state.categories.length ? 1 : 0) > 0 && (
        <p className="-mt-2 text-center text-[11.5px] text-subtle">Uses {Math.max(1, state.categories.length)} map search {Math.max(1, state.categories.length) === 1 ? 'request' : 'requests'}</p>
      )}
      <div className="border-t border-line pt-5">
        <div className="mb-3 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-subtle">
          <SlidersHorizontal className="size-3.5" /> Filters
        </div>
        <FiltersPanel filters={state.filters} onChange={(f) => setState((s) => ({ ...s, filters: f }))} />
        <p className="mt-3 text-[11.5px] leading-relaxed text-subtle">Filters apply instantly to the current results without another search.</p>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {!placesEnabled && (
        <div className="border-b border-line px-4 py-2.5">
          <Notice tone="warning" title="Business discovery is not configured">
            An administrator needs to set <code className="font-mono text-[12px]">GOOGLE_MAPS_API_KEY</code> (Places API (New) and Geocoding API enabled) on the server. The interactive map also needs <code className="font-mono text-[12px]">GOOGLE_MAPS_BROWSER_KEY</code>.
          </Notice>
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-line bg-canvas px-4 py-2 lg:hidden">
        <SegmentedControl value={mobileView} onChange={setMobileView} size="sm" options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />
        <Button size="sm" variant="secondary" leftIcon={<ListFilter />} onClick={() => setFiltersOpenMobile(true)} className="ml-auto">
          Search and filters
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_1fr_400px]">
        {/* Left: search controls */}
        <aside className="hidden min-h-0 flex-col border-r border-line bg-canvas lg:flex">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h1 className="text-[15px] font-semibold tracking-tight">Discover</h1>
            <Menu>
              <MenuTrigger asChild>
                <Button size="xs" variant="ghost" leftIcon={<History />}>
                  Searches
                </Button>
              </MenuTrigger>
              <MenuContent align="end" className="w-[300px]">
                <MenuLabel>Saved searches</MenuLabel>
                {saved.data?.savedSearches.length ? (
                  saved.data.savedSearches.slice(0, 8).map((s) => (
                    <MenuItem key={s.id} icon={<Bookmark />} onSelect={() => setParams({ saved: s.id })}>
                      {s.name}
                    </MenuItem>
                  ))
                ) : (
                  <div className="px-2 py-1.5 text-[12.5px] text-muted">No saved searches yet.</div>
                )}
                <MenuSeparator />
                <MenuLabel>Recent</MenuLabel>
                {history.data?.history.length ? (
                  history.data.history.slice(0, 6).map((h) => (
                    <MenuItem key={h.id} icon={<Clock />} onSelect={() => setParams({ history: h.id })}>
                      <span className="block truncate">{h.label}</span>
                    </MenuItem>
                  ))
                ) : (
                  <div className="px-2 py-1.5 text-[12.5px] text-muted">No searches yet.</div>
                )}
                <MenuSeparator />
                <MenuItem icon={<History />} onSelect={() => navigate('/app/discover?panel=history')}>
                  Manage search history
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{controls}</div>
        </aside>

        {/* Center: map */}
        <section className={cn('relative min-h-0', mobileView === 'map' ? 'block' : 'hidden lg:block')} aria-label="Map">
          <MapView
            center={center}
            radiusMeters={state.radiusMeters}
            businesses={visible.map((r) => ({ placeId: r.placeId, name: r.name, location: r.location, opportunity: r.opportunity }))}
            selectedId={activeId}
            hoveredId={hoveredId}
            onSelect={(id) => {
              activate(id, true);
              if (window.innerWidth < 1024) setDetailsId(id);
            }}
            onHover={setHoveredId}
            onCenterChange={async (p) => {
              setState((s) => ({ ...s, location: { label: `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`, placeId: null, lat: p.lat, lng: p.lng, source: 'pin', resolvedAt: null } }));
              if (placesEnabled) {
                try {
                  const r = await api.get<{ location: { label: string } }>(`/api/locations/reverse?lat=${p.lat}&lng=${p.lng}`);
                  setState((s) => (s.location?.lat === p.lat && s.location?.lng === p.lng ? { ...s, location: { ...s.location, label: r.location.label } } : s));
                } catch {
                  /* keep coordinates as label */
                }
              }
            }}
            onRadiusChange={(m) => setState((s) => ({ ...s, radiusMeters: m }))}
            searching={searching}
          />
        </section>

        {/* Right: results */}
        <section className={cn('min-h-0 flex-col border-l border-line bg-panel', mobileView === 'list' ? 'flex' : 'hidden lg:flex')} aria-label="Results">
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[14px] font-semibold">
                  {response ? `${formatNumber(visible.length)} of ${formatNumber(results.length)} businesses` : 'Results'}
                </div>
                {response && (
                  <div className="mt-0.5 text-[12px] text-muted">
                    {formatNumber(opportunities)} potential website {opportunities === 1 ? 'opportunity' : 'opportunities'}
                    {response.excludedOutsideRadius > 0 && ` \u00b7 ${response.excludedOutsideRadius} outside the radius hidden`}
                  </div>
                )}
              </div>
              {response && (
                <div className="flex items-center gap-1">
                  <Tooltip content="Save this search">
                    <Button size="icon-sm" variant="ghost" aria-label="Save this search" onClick={() => setSaveSearchOpen(true)}>
                      <BookmarkPlus />
                    </Button>
                  </Tooltip>
                  <Select size="sm" value={sort} onChange={(e) => setSort(e.target.value as DiscoverySort)} aria-label="Sort results" className="w-[130px]">
                    <option value="distance">Nearest</option>
                    <option value="signals">Most signals</option>
                    <option value="rating">Highest rated</option>
                    <option value="reviews">Most reviews</option>
                    <option value="name">Name</option>
                  </Select>
                </div>
              )}
            </div>
            {response && visible.length > 0 && (
              <div className="mt-2.5 flex items-center gap-2">
                <Checkbox
                  checked={allSelected ? true : selectedIds.size > 0 ? 'indeterminate' : false}
                  onCheckedChange={(v) => setSelectedIds(v ? new Set(selectableVisible.map((r) => r.placeId)) : new Set())}
                  label="Select all"
                />
                {selectedIds.size > 0 ? (
                  <>
                    <span className="text-[12.5px] text-muted">{selectedIds.size} selected</span>
                    <Button size="xs" variant="primary" className="ml-auto" leftIcon={<Plus />} loading={savingIds.size > 0} onClick={() => saveProspects(results.filter((r) => selectedIds.has(r.placeId)))}>
                      Save {selectedIds.size} as prospects
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-[12.5px] text-muted">Select all</span>
                    <Tooltip content="Checks whether listed websites respond. Localy makes one lightweight request per site and reads no page content.">
                      <Button size="xs" variant="ghost" className="ml-auto" leftIcon={<ShieldCheck />} loading={checking} onClick={checkWebsites}>
                        Check listed websites
                      </Button>
                    </Tooltip>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-busy={searching}>
            {searching ? (
              <div>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="border-b border-line px-4 py-4">
                    <div className="flex gap-3">
                      <Skeleton className="size-4 rounded-[4px]" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-5 w-28" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <EmptyState
                compact
                icon={<Info />}
                title={error.code === 'LIMIT_REACHED' ? 'Plan limit reached' : error.code === 'NOT_CONFIGURED' ? 'Discovery not configured' : error.code === 'INVALID_ADDRESS' ? 'Location not found' : 'Search failed'}
                description={error.message}
                action={
                  error.code === 'LIMIT_REACHED' ? (
                    <Button variant="primary" asChild>
                      <Link to="/app/billing">View plans</Link>
                    </Button>
                  ) : (
                    <Button onClick={() => run()}>Try again</Button>
                  )
                }
              />
            ) : !response ? (
              <EmptyState
                compact
                icon={<MapIcon />}
                title="Search an area to find businesses"
                description="Choose a location and radius, pick one or more business categories, then select Discover businesses."
              />
            ) : results.length === 0 ? (
              <EmptyState compact icon={<Search />} title="No businesses found" description="Try a larger radius, a different category, or a broader keyword." />
            ) : visible.length === 0 ? (
              <EmptyState
                compact
                icon={<ListFilter />}
                title="No results match your filters"
                description={`${formatNumber(results.length)} businesses were found, but none match the current filters.`}
                action={<Button onClick={() => setState((s) => ({ ...s, filters: { ...DEFAULT_FILTERS, website: 'any' } }))}>Clear filters</Button>}
              />
            ) : (
              <>
                {visible.map((r) => (
                  <BusinessCard
                    key={r.placeId}
                    ref={(el) => {
                      if (el) cardRefs.current.set(r.placeId, el);
                      else cardRefs.current.delete(r.placeId);
                    }}
                    result={r}
                    unit={unit}
                    selected={selectedIds.has(r.placeId)}
                    active={activeId === r.placeId}
                    hovered={hoveredId === r.placeId}
                    saving={savingIds.has(r.placeId)}
                    onToggleSelect={() =>
                      setSelectedIds((s) => {
                        const n = new Set(s);
                        if (n.has(r.placeId)) n.delete(r.placeId);
                        else n.add(r.placeId);
                        return n;
                      })
                    }
                    onActivate={() => activate(r.placeId)}
                    onHover={(h) => setHoveredId(h ? r.placeId : null)}
                    onSave={() => saveProspects([r])}
                    onDetails={() => setDetailsId(r.placeId)}
                  />
                ))}
                {response.hasMore && (
                  <div className="p-4">
                    <Button className="w-full" loading={loadingMore} onClick={loadMore}>
                      Load more results
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
          {response && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11.5px] text-subtle">
              <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setRankingInfo(true)}>
                <Info className="size-3" /> How results are ranked
              </button>
              <span>
                {formatNumber(response.usage.discovered.used)} / {formatNumber(response.usage.discovered.limit)} discovered this month
              </span>
            </div>
          )}
        </section>
      </div>

      <DetailsDrawer result={detailsResult} onClose={() => setDetailsId(null)} onSave={() => detailsResult && saveProspects([detailsResult])} saving={Boolean(detailsResult && savingIds.has(detailsResult.placeId))} unit={unit} />

      <Drawer open={filtersOpenMobile} onOpenChange={setFiltersOpenMobile} title="Search and filters" footer={<Button variant="primary" onClick={() => { setFiltersOpenMobile(false); void run(); }} loading={searching}>Discover businesses</Button>}>
        {controls}
      </Drawer>

      <SaveSearchDialog open={saveSearchOpen} onOpenChange={setSaveSearchOpen} state={state} existingId={savedSearchId} />
      <HistoryPanel open={params.get('panel') === 'history'} onClose={() => setParams({}, { replace: true })} />

      <Dialog open={rankingInfo} onOpenChange={setRankingInfo} title="How results are ranked" size="sm">
        <p className="text-[13.5px] leading-relaxed text-ink-2">{GOOGLE_MAPS_RANKING_EXPLAINER}</p>
        <p className="mt-3 text-[13px] text-muted">
          Localy then sorts results by the option you choose (nearest by default) and applies your filters locally.{' '}
          <a href={GOOGLE_MAPS_RANKING_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline-offset-2 hover:underline">
            Learn more
          </a>
        </p>
      </Dialog>
    </div>
  );
}

function SaveSearchDialog({ open, onOpenChange, state, existingId }: { open: boolean; onOpenChange: (o: boolean) => void; state: SearchState; existingId: string | null }) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) setName(`${state.categories.map(categoryLabel).join(', ') || state.keyword || 'Businesses'} near ${state.location?.label.split(',')[0] ?? ''}`.slice(0, 120));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(
    (asNew: boolean) => {
      const body = { name, config: { categories: state.categories, keyword: state.keyword || null, location: state.location, radiusMeters: state.radiusMeters, filters: state.filters } };
      return existingId && !asNew ? api.put(`/api/saved-searches/${existingId}`, body) : api.post('/api/saved-searches', body);
    },
    { success: 'Search saved', invalidate: [['saved-searches']], onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Save search"
      description="Rerun this search any time from the Searches menu."
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          {existingId && (
            <Button onClick={() => save.mutate(true)} disabled={!name.trim()}>
              Save as new
            </Button>
          )}
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || !state.location} onClick={() => save.mutate(false)}>
            {existingId ? 'Update search' : 'Save search'}
          </Button>
        </>
      }
    >
      <Field label="Name" htmlFor="ss-name">
        <Input id="ss-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <dl className="mt-4 space-y-1.5 text-[12.5px]">
        <div className="flex gap-2"><dt className="w-20 text-muted">Location</dt><dd className="flex-1">{state.location?.label ?? 'None'}</dd></div>
        <div className="flex gap-2"><dt className="w-20 text-muted">Radius</dt><dd>{formatRadius(state.radiusMeters)}</dd></div>
        <div className="flex gap-2"><dt className="w-20 text-muted">Categories</dt><dd className="flex-1">{state.categories.map(categoryLabel).join(', ') || 'None'}</dd></div>
        <div className="flex gap-2"><dt className="w-20 text-muted">Website</dt><dd>{WEBSITE_FILTER_LABELS[state.filters.website]}</dd></div>
      </dl>
    </Dialog>
  );
}

function HistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const history = useApi<{ history: SearchHistoryItem[] }>(['discovery-history'], open ? '/api/discovery/history' : null);
  const saved = useApi<{ savedSearches: SavedSearchItem[] }>(['saved-searches'], open ? '/api/saved-searches' : null);
  const del = useAction((id: string) => api.delete(`/api/discovery/history/${id}`), { invalidate: [['discovery-history']] });
  const clear = useAction(() => api.delete('/api/discovery/history'), { success: 'Search history cleared', invalidate: [['discovery-history']] });
  const delSaved = useAction((id: string) => api.delete(`/api/saved-searches/${id}`), { success: 'Saved search deleted', invalidate: [['saved-searches']] });
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} title="Searches" description="Localy stores your search settings and Google place IDs only." width="max-w-[520px]">
      <div className="space-y-8">
        <div>
          <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-subtle">Saved searches</h3>
          {saved.isLoading ? (
            <Skeleton className="h-16" />
          ) : !saved.data?.savedSearches.length ? (
            <p className="text-[13px] text-muted">Save a search from the results panel to rerun it later.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {saved.data.savedSearches.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{s.name}</div>
                    <div className="truncate text-[12px] text-muted">
                      {s.config.categories.map(categoryLabel).join(', ')} &middot; {formatRadius(s.config.radiusMeters)} &middot; {WEBSITE_FILTER_LABELS[s.config.filters.website]}
                      {s.lastRunAt && ` \u00b7 run ${timeAgo(s.lastRunAt)}`}
                    </div>
                  </div>
                  <Button size="xs" variant="primary" onClick={() => { onClose(); navigate(`/app/discover?saved=${s.id}`); }}>
                    Run
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Delete saved search" onClick={() => delSaved.mutate(s.id)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[12px] font-medium uppercase tracking-wider text-subtle">History</h3>
            {Boolean(history.data?.history.length) && (
              <Button size="xs" variant="ghost" onClick={() => clear.mutate(undefined)}>
                Clear history
              </Button>
            )}
          </div>
          {history.isLoading ? (
            <Skeleton className="h-24" />
          ) : !history.data?.history.length ? (
            <p className="text-[13px] text-muted">Your recent searches will appear here.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {history.data.history.map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{h.label}</div>
                    <div className="text-[12px] text-muted">
                      {formatRadius(h.radiusMeters)} &middot; {pluralize(h.resultCount, 'result')} &middot; {h.opportunityCount} opportunities &middot; {timeAgo(h.createdAt)}
                      {h.user && ` \u00b7 ${h.user.name}`}
                    </div>
                  </div>
                  <Button size="xs" onClick={() => { onClose(); navigate(`/app/discover?history=${h.id}`); }}>
                    Reopen
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Delete from history" onClick={() => del.mutate(h.id)}>
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  );
}

