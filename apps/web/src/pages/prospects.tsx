import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { Archive, ArrowUpDown, Building2, ChevronLeft, ChevronRight, Download, Map as MapIcon, Megaphone, MoreHorizontal, Plus, Search, Tag, Trash2, PenSquare, CircleDot } from 'lucide-react';
import {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  SIGNAL_DEFINITIONS,
  SIGNAL_KEYS,
  WEBSITE_STATUS_LABELS,
  type Paginated,
  type ProspectListItem,
  type ProspectStatus,
} from '@localy/shared';
import { api, download, errorMessage, qs } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useLivePlaces } from '@/lib/places';
import { cn, formatNumber, pluralize, timeAgo } from '@/lib/utils';
import { useCan } from '@/lib/session';
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, EmptyState, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger, Select, SkeletonRows, Tabs, Tooltip } from '@/components/ui';
import { PageHeader } from '@/components/app/page';
import { ProspectStatusBadge, WebsiteStatusBadge } from '@/components/app/status';
import { NewProspectDialog } from '@/components/prospects/new-prospect-dialog';
import { AddToCampaignDialog } from '@/components/prospects/add-to-campaign';

const PAGE_SIZE = 50;

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function Prospects() {
  const navigate = useNavigate();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search);
  const status = params.get('status') ?? 'active';
  const tagId = params.get('tag') ?? '';
  const website = params.get('website') ?? 'any';
  const hasEmail = params.get('email') ?? 'any';
  const sort = params.get('sort') ?? 'created_desc';
  const signal = params.get('signal') ?? '';
  const page = Number(params.get('page') ?? '1');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [newTag, setNewTag] = useState('');
  const newOpen = params.get('new') === '1';
  const campaignTarget = params.get('campaignTarget');
  const targetCampaign = useApi<{ campaign: { id: string; name: string } }>(['campaign', campaignTarget], campaignTarget ? `/api/campaigns/${campaignTarget}` : null);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null || v === '' || v === 'any' || (k === 'status' && v === 'active')) next.delete(k);
    else next.set(k, v);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
    setSelected(new Set());
    setSelectAllMatching(false);
  };

  const filterQs = { q: q || undefined, status, tagId: tagId || undefined, website: website !== 'any' ? website : undefined, hasEmail: hasEmail !== 'any' ? hasEmail : undefined, sort, signal: signal || undefined };
  const list = useApi<Paginated<ProspectListItem>>(['prospects', filterQs, page], `/api/prospects${qs({ ...filterQs, page, pageSize: PAGE_SIZE })}`, { placeholderData: (p) => p });
  const counts = useApi<{ counts: Partial<Record<ProspectStatus, number>> }>(['prospects', 'counts'], '/api/prospects/counts');
  const tags = useApi<{ tags: { id: string; name: string; count: number }[] }>(['tags'], '/api/tags');
  const items = list.data?.items ?? [];
  const live = useLivePlaces(items.filter((i) => !i.name).map((i) => i.placeId));
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (params.get('q') !== (q || null)) setParam('q', q);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const ids = async (): Promise<string[]> => {
    if (!selectAllMatching) return [...selected];
    const r = await api.get<{ ids: string[] }>(`/api/prospects/ids${qs(filterQs)}`);
    return r.ids;
  };

  const bulk = useAction(
    async (body: Record<string, unknown>) => api.post<{ affected: number }>('/api/prospects/bulk', { ...body, ids: await ids() }),
    {
      success: (r) => `Updated ${pluralize(r.affected, 'prospect')}`,
      invalidate: [['prospects'], ['tags'], ['dashboard']],
      onSuccess: () => {
        setSelected(new Set());
        setSelectAllMatching(false);
        setConfirmDelete(false);
        setTagOpen(false);
        setNewTag('');
      },
    },
  );

  const exportData = async (format: 'csv' | 'json') => {
    try {
      const selIds = selectAllMatching || selected.size === 0 ? undefined : [...selected].join(',');
      await download(`/api/prospects/export${qs({ ...filterQs, format, ids: selIds })}`, `localy-prospects.${format}`);
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const selectedCount = selectAllMatching ? total : selected.size;
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.id));
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => parentRef.current, estimateSize: () => 57, overscan: 12 });

  const activeCount = useMemo(() => Object.entries(counts.data?.counts ?? {}).filter(([k]) => k !== 'archived').reduce((a, [, v]) => a + (v ?? 0), 0), [counts.data]);
  const statusTabs = [
    { value: 'active', label: 'All active', count: activeCount },
    { value: 'new', label: 'New', count: counts.data?.counts.new ?? 0 },
    { value: 'contacted', label: 'Contacted', count: counts.data?.counts.contacted ?? 0 },
    { value: 'replied', label: 'Replied', count: counts.data?.counts.replied ?? 0 },
    { value: 'interested', label: 'Interested', count: counts.data?.counts.interested ?? 0 },
    { value: 'client', label: 'Clients', count: counts.data?.counts.client ?? 0 },
    { value: 'archived', label: 'Archived', count: counts.data?.counts.archived ?? 0 },
  ];
  const filtered = Boolean(q || tagId || website !== 'any' || hasEmail !== 'any' || signal || !['active'].includes(status));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Prospects"
        description="Businesses you've saved. Names and addresses for Google Maps businesses are loaded live."
        actions={
          <>
            <Menu>
              <MenuTrigger asChild>
                <Button leftIcon={<Download />}>Export</Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>{selected.size && !selectAllMatching ? `${selected.size} selected` : 'Current filters'}</MenuLabel>
                <MenuItem onSelect={() => exportData('csv')} disabled={!can.manageWorkspace}>
                  Export CSV
                </MenuItem>
                <MenuItem onSelect={() => exportData('json')} disabled={!can.manageWorkspace}>
                  Export JSON
                </MenuItem>
                <MenuSeparator />
                <div className="max-w-[240px] px-2 py-1.5 text-[11.5px] leading-snug text-muted">Exports include your own data and Google place IDs. Business details from Google Maps are not stored, so they are not exported.</div>
              </MenuContent>
            </Menu>
            <Button variant="primary" leftIcon={<Plus />} onClick={() => setParam('new', '1')}>
              New prospect
            </Button>
          </>
        }
      >
        <Tabs className="mt-4 -mb-4" value={statusTabs.some((t) => t.value === status) ? status : 'active'} onValueChange={(v) => setParam('status', v)} items={statusTabs} />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-5 py-2.5 md:px-8">
        <div className="w-full sm:w-[260px]">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, location" leftIcon={<Search />} className="h-8" aria-label="Search prospects" />
        </div>
        <Select size="sm" value={website} onChange={(e) => setParam('website', e.target.value)} aria-label="Website status" className="w-[170px]">
          <option value="any">Any website status</option>
          <option value="opportunity">Website opportunity</option>
          {(['not_listed', 'listed', 'detected', 'unavailable', 'unknown'] as const).map((w) => (
            <option key={w} value={w}>
              {WEBSITE_STATUS_LABELS[w]}
            </option>
          ))}
        </Select>
        <Select size="sm" value={hasEmail} onChange={(e) => setParam('email', e.target.value)} aria-label="Email" className="w-[130px]">
          <option value="any">Any email</option>
          <option value="yes">Has email</option>
          <option value="no">No email</option>
        </Select>
        <Select size="sm" value={tagId} onChange={(e) => setParam('tag', e.target.value)} aria-label="Tag" className="w-[140px]">
          <option value="">Any tag</option>
          {tags.data?.tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.count})
            </option>
          ))}
        </Select>
        <Select size="sm" value={signal} onChange={(e) => setParam('signal', e.target.value)} aria-label="Signal" className="w-[160px]">
          <option value="">Any signal</option>
          {SIGNAL_KEYS.map((k) => (
            <option key={k} value={k}>
              {SIGNAL_DEFINITIONS[k].label}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <ArrowUpDown className="size-3.5 text-subtle" aria-hidden />
          <Select size="sm" value={sort} onChange={(e) => setParam('sort', e.target.value)} aria-label="Sort" className="w-[170px]">
            <option value="created_desc">Newest first</option>
            <option value="created_asc">Oldest first</option>
            <option value="updated_desc">Recently updated</option>
            <option value="last_contacted_desc">Last contacted</option>
            <option value="name_asc">Name (your names)</option>
            <option value="signals_desc">Most signals</option>
            {SIGNAL_KEYS.map((k) => (
              <option key={k} value={k}>
                Signal: {SIGNAL_DEFINITIONS[k].label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {campaignTarget && targetCampaign.data && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-[#f3f6ff] px-5 py-2.5 text-[13px] text-[#1e3a8a] md:px-8">
          <Megaphone className="size-4" />
          <span className="flex-1">
            Select prospects to add to <span className="font-semibold">{targetCampaign.data.campaign.name}</span>, then choose Add to campaign.
          </span>
          <Button size="xs" onClick={() => navigate(`/app/campaigns/${campaignTarget}`)}>
            Back to campaign
          </Button>
        </div>
      )}

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-wash px-5 py-2 md:px-8 animate-fade-in">
          <span className="text-[13px] font-medium">{pluralize(selectedCount, 'prospect')} selected</span>
          {!selectAllMatching && allOnPage && total > items.length && (
            <button type="button" className="text-[13px] text-ink underline-offset-2 hover:underline" onClick={() => setSelectAllMatching(true)}>
              Select all {formatNumber(total)} matching
            </button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" leftIcon={<Megaphone />} onClick={() => setCampaignOpen(true)}>
              Add to campaign
            </Button>
            <Button size="sm" leftIcon={<PenSquare />} onClick={async () => navigate(`/app/compose?prospects=${(await ids()).slice(0, 500).join(',')}`)}>
              Compose
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" leftIcon={<CircleDot />}>Change status</Button>
              </MenuTrigger>
              <MenuContent>
                {PROSPECT_STATUSES.map((s) => (
                  <MenuItem key={s} onSelect={() => bulk.mutate({ action: 'status', status: s })}>
                    {PROSPECT_STATUS_LABELS[s]}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" leftIcon={<Tag />}>Tag</Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Add tag</MenuLabel>
                {tags.data?.tags.map((t) => (
                  <MenuItem key={t.id} onSelect={() => bulk.mutate({ action: 'add_tag', tagId: t.id })}>
                    {t.name}
                  </MenuItem>
                ))}
                <MenuItem icon={<Plus />} onSelect={() => setTagOpen(true)}>
                  New tag
                </MenuItem>
                {Boolean(tags.data?.tags.length) && (
                  <MenuSub>
                    <MenuSubTrigger>Remove tag</MenuSubTrigger>
                    <MenuSubContent>
                      {tags.data!.tags.map((t) => (
                        <MenuItem key={t.id} onSelect={() => bulk.mutate({ action: 'remove_tag', tagId: t.id })}>
                          {t.name}
                        </MenuItem>
                      ))}
                    </MenuSubContent>
                  </MenuSub>
                )}
              </MenuContent>
            </Menu>
            <Button size="sm" leftIcon={<Archive />} onClick={() => bulk.mutate({ action: 'archive' })}>
              Archive
            </Button>
            <Tooltip content="Delete permanently">
              <Button size="sm" variant="ghost" aria-label="Delete" onClick={() => setConfirmDelete(true)}>
                <Trash2 />
              </Button>
            </Tooltip>
            <Button size="sm" variant="ghost" onClick={() => { setSelected(new Set()); setSelectAllMatching(false); }}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col bg-panel">
        <div className="hidden grid-cols-[36px_minmax(220px,2fr)_120px_150px_minmax(140px,1fr)_120px_40px] items-center gap-3 border-b border-line px-5 py-2 text-[11.5px] font-medium uppercase tracking-wider text-subtle md:grid md:px-8" role="row">
          <Checkbox checked={allOnPage ? true : selected.size > 0 ? 'indeterminate' : false} onCheckedChange={(v) => { setSelectAllMatching(false); setSelected(v ? new Set(items.map((i) => i.id)) : new Set()); }} label="Select all on this page" />
          <span>Business</span>
          <span>Status</span>
          <span>Website</span>
          <span>Contact</span>
          <span>Last contacted</span>
          <span />
        </div>
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
          {list.isLoading ? (
            <SkeletonRows rows={10} />
          ) : list.error ? (
            <EmptyState title="Prospects could not be loaded" description={list.error.message} action={<Button onClick={() => list.refetch()}>Try again</Button>} />
          ) : items.length === 0 ? (
            filtered ? (
              <EmptyState icon={<Search />} title="No prospects match these filters" description="Try clearing a filter or searching for something else." action={<Button onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Clear filters</Button>} />
            ) : (
              <EmptyState
                icon={<Building2 />}
                title="Your prospect list is empty."
                description="Discover businesses in your target area to start building your list."
                action={
                  <>
                    <Button variant="primary" leftIcon={<MapIcon />} onClick={() => navigate('/app/discover')}>
                      Discover businesses
                    </Button>
                    <Button leftIcon={<Plus />} onClick={() => setParam('new', '1')}>
                      Add manually
                    </Button>
                  </>
                }
              />
            )
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((v) => {
                const p = items[v.index];
                const summary = p.name ? null : live.get(p.placeId);
                const name = p.name ?? summary?.name;
                const place = p.locationLabel ?? summary?.locality ?? summary?.shortAddress;
                const category = p.categoryLabel ?? summary?.category;
                return (
                  <div
                    key={p.id}
                    data-index={v.index}
                    ref={virtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)` }}
                    className={cn('group grid cursor-pointer grid-cols-[36px_1fr_auto] items-center gap-3 border-b border-line px-5 py-2.5 transition-colors hover:bg-hover/50 md:grid-cols-[36px_minmax(220px,2fr)_120px_150px_minmax(140px,1fr)_120px_40px] md:px-8', selected.has(p.id) && 'bg-wash/70')}
                    onClick={() => navigate(`/app/prospects/${p.id}`)}
                    role="row"
                  >
                    <Checkbox
                      checked={selectAllMatching || selected.has(p.id)}
                      onCheckedChange={(c) => {
                        setSelectAllMatching(false);
                        setSelected((s) => {
                          const n = new Set(s);
                          if (c) n.add(p.id);
                          else n.delete(p.id);
                          return n;
                        });
                      }}
                      label={`Select ${name ?? 'prospect'}`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {name ? <Link to={`/app/prospects/${p.id}`} onClick={(e) => e.stopPropagation()} className="truncate text-[13.5px] font-medium text-ink hover:underline">{name}</Link> : live.loading(p.placeId) ? <span className="skeleton inline-block h-3.5 w-40" /> : <span className="truncate text-[13.5px] text-muted">Business on Google Maps</span>}
                        {p.unsubscribed && <Badge tone="danger">Unsubscribed</Badge>}
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[12px] text-muted">
                        {category && <span className="truncate first-letter:uppercase">{category}</span>}
                        {category && place && <span aria-hidden>&middot;</span>}
                        {place && <span className="truncate">{place}</span>}
                        {p.tags.slice(0, 2).map((t) => (
                          <Badge key={t.id} tone="outline" className="h-[18px] text-[10.5px]">
                            {t.name}
                          </Badge>
                        ))}
                        {p.tags.length > 2 && <span className="text-[11px]">+{p.tags.length - 2}</span>}
                      </div>
                    </div>
                    <div className="md:hidden">
                      <ProspectStatusBadge status={p.status} />
                    </div>
                    <div className="hidden md:block">
                      <ProspectStatusBadge status={p.status} />
                    </div>
                    <div className="hidden md:block">
                      <WebsiteStatusBadge status={p.websiteStatus} socialOnly={p.socialProfileOnly} />
                    </div>
                    <div className="hidden min-w-0 md:block">
                      {p.email ? <div className="truncate text-[12.5px] text-ink-2">{p.email}</div> : <div className="text-[12.5px] text-subtle">No email yet</div>}
                      {p.contactName && <div className="truncate text-[11.5px] text-muted">{p.contactName}</div>}
                    </div>
                    <div className="hidden text-[12.5px] text-muted md:block">{p.lastContactedAt ? timeAgo(p.lastContactedAt) : 'Never'}</div>
                    <div className="hidden md:block" onClick={(e) => e.stopPropagation()}>
                      <Menu>
                        <MenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label="More actions" className="opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100">
                            <MoreHorizontal />
                          </Button>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuItem onSelect={() => navigate(`/app/prospects/${p.id}`)}>Open</MenuItem>
                          <MenuItem onSelect={() => navigate(`/app/compose?prospects=${p.id}`)}>Compose email</MenuItem>
                          <MenuSeparator />
                          {PROSPECT_STATUSES.filter((s) => s !== p.status).slice(0, 8).map((s) => (
                            <MenuItem key={s} onSelect={() => api.post('/api/prospects/bulk', { ids: [p.id], action: 'status', status: s }).then(() => list.refetch()).then(() => counts.refetch())}>
                              Mark {PROSPECT_STATUS_LABELS[s].toLowerCase()}
                            </MenuItem>
                          ))}
                        </MenuContent>
                      </Menu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-[12.5px] text-muted md:px-8">
            <span>
              {formatNumber((page - 1) * PAGE_SIZE + 1)} to {formatNumber(Math.min(total, page * PAGE_SIZE))} of {formatNumber(total)}
              {list.isFetching && !list.isLoading && ' \u00b7 updating'}
            </span>
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <span className="tabular px-2">
                {page} / {pages}
              </span>
              <Button size="icon-sm" variant="ghost" disabled={page >= pages} onClick={() => setParam('page', String(page + 1))} aria-label="Next page">
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </div>

      <NewProspectDialog open={newOpen} onOpenChange={(o) => !o && setParam('new', null)} />
      <AddToCampaignDialog open={campaignOpen && !selectAllMatching} onOpenChange={setCampaignOpen} prospectIds={[...selected]} defaultCampaignId={campaignTarget} onDone={() => { setSelected(new Set()); if (campaignTarget) navigate(`/app/campaigns/${campaignTarget}`); }} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${pluralize(selectedCount, 'prospect')}?`}
        description="This permanently deletes the prospects, their notes, activity and email history. Archive them instead if you might need them later."
        confirmLabel="Delete permanently"
        destructive
        loading={bulk.isPending}
        onConfirm={() => bulk.mutate({ action: 'delete' })}
      />
      <Dialog
        open={tagOpen}
        onOpenChange={setTagOpen}
        title="New tag"
        size="sm"
        footer={
          <>
            <Button onClick={() => setTagOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!newTag.trim()} loading={bulk.isPending} onClick={() => bulk.mutate({ action: 'add_tag', tagName: newTag.trim() })}>
              Create and apply
            </Button>
          </>
        }
      >
        <Input autoFocus value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="High value" maxLength={40} aria-label="Tag name" />
      </Dialog>
      {selectAllMatching && campaignOpen && <SelectAllCampaignBridge filterQs={filterQs} onClose={() => setCampaignOpen(false)} />}
    </div>
  );
}

/** When "select all matching" is active, resolve IDs before opening the campaign dialog. */
function SelectAllCampaignBridge({ filterQs, onClose }: { filterQs: Record<string, string | undefined>; onClose: () => void }) {
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => {
    api.get<{ ids: string[] }>(`/api/prospects/ids${qs(filterQs)}`).then((r) => setIds(r.ids));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ids) return null;
  return <AddToCampaignDialog open onOpenChange={(o) => !o && onClose()} prospectIds={ids} defaultCampaignId={new URLSearchParams(window.location.search).get('campaignTarget')} />;
}

