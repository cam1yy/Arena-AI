import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Building2,
  FileText,
  Inbox,
  LayoutDashboard,
  Map,
  Megaphone,
  Plug,
  Search,
  Settings,
  StickyNote,
  CreditCard,
  Plus,
  PenSquare,
  CalendarClock,
  HelpCircle,
} from 'lucide-react';
import { PROSPECT_STATUS_LABELS, type ProspectStatus } from '@localy/shared';
import { api, qs } from '@/lib/api';
import { useLivePlaces } from '@/lib/places';

interface SearchResults {
  prospects: { id: string; name: string | null; placeId: string | null; email: string | null; status: ProspectStatus; locationLabel: string | null }[];
  campaigns: { id: string; name: string; status: string }[];
  templates: { id: string; name: string; subject: string }[];
  notes: { id: string; body: string; prospectId: string; prospectName: string | null; placeId: string | null }[];
}

function useDebounced<T>(value: T, ms = 180) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const { data, isFetching } = useQuery<SearchResults>({
    queryKey: ['search', q],
    queryFn: () => api.get(`/api/search${qs({ q })}`),
    enabled: open && q.length >= 2,
    staleTime: 10_000,
  });
  const live = useLivePlaces([...(data?.prospects ?? []).filter((p) => !p.name).map((p) => p.placeId), ...(data?.notes ?? []).filter((n) => !n.prospectName).map((n) => n.placeId)]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  const nav = [
    { label: 'Overview', icon: LayoutDashboard, to: '/app' },
    { label: 'Discover businesses', icon: Map, to: '/app/discover' },
    { label: 'Prospects', icon: Building2, to: '/app/prospects' },
    { label: 'Campaigns', icon: Megaphone, to: '/app/campaigns' },
    { label: 'Templates', icon: FileText, to: '/app/templates' },
    { label: 'Follow-ups', icon: CalendarClock, to: '/app/follow-ups' },
    { label: 'Analytics', icon: BarChart3, to: '/app/analytics' },
    { label: 'Inbox', icon: Inbox, to: '/app/inbox' },
    { label: 'Integrations', icon: Plug, to: '/app/integrations' },
    { label: 'Billing', icon: CreditCard, to: '/app/billing' },
    { label: 'Settings', icon: Settings, to: '/app/settings' },
    { label: 'Help', icon: HelpCircle, to: '/app/help' },
  ];
  const actions = [
    { label: 'New prospect', icon: Plus, to: '/app/prospects?new=1', shortcut: 'N' },
    { label: 'Create campaign', icon: Megaphone, to: '/app/campaigns/new', shortcut: 'C' },
    { label: 'Create template', icon: PenSquare, to: '/app/templates?new=1', shortcut: 'T' },
    { label: 'Compose email', icon: PenSquare, to: '/app/compose' },
  ];
  const itemCls = 'flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13.5px] text-ink-2 data-[selected=true]:bg-hover data-[selected=true]:text-ink [&_svg]:size-4 [&_svg]:text-muted';
  const groupCls = '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle';
  const hasResults = data && (data.prospects.length || data.campaigns.length || data.templates.length || data.notes.length);

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-fade-in" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-[600px] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-panel shadow-lg focus:outline-none data-[state=open]:animate-scale-in">
          <D.Title className="sr-only">Search Localy</D.Title>
          <D.Description className="sr-only">Search prospects, campaigns, templates and notes, or jump to a page.</D.Description>
          <Command shouldFilter={q.length < 2} loop label="Global search">
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search className="size-4 text-subtle" aria-hidden />
              <Command.Input value={query} onValueChange={setQuery} placeholder="Search prospects, campaigns, templates, notes..." className="h-12 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-subtle" />
              {isFetching && <span className="text-[11px] text-subtle">Searching</span>}
            </div>
            <Command.List className="max-h-[420px] overflow-y-auto p-1.5">
              <Command.Empty className="px-4 py-10 text-center text-[13px] text-muted">{q.length >= 2 && !isFetching ? `No results for "${q}".` : 'Type to search.'}</Command.Empty>
              {q.length >= 2 && hasResults ? (
                <>
                  {data!.prospects.length > 0 && (
                    <Command.Group heading="Prospects" className={groupCls}>
                      {data!.prospects.map((p) => (
                        <Command.Item key={p.id} value={`p-${p.id}`} onSelect={() => go(`/app/prospects/${p.id}`)} className={itemCls}>
                          <Building2 />
                          <span className="flex-1 truncate">{p.name ?? live.get(p.placeId)?.name ?? 'Business on Google Maps'}</span>
                          <span className="text-[12px] text-subtle">{PROSPECT_STATUS_LABELS[p.status]}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {data!.campaigns.length > 0 && (
                    <Command.Group heading="Campaigns" className={groupCls}>
                      {data!.campaigns.map((c) => (
                        <Command.Item key={c.id} value={`c-${c.id}`} onSelect={() => go(`/app/campaigns/${c.id}`)} className={itemCls}>
                          <Megaphone />
                          <span className="flex-1 truncate">{c.name}</span>
                          <span className="text-[12px] capitalize text-subtle">{c.status}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {data!.templates.length > 0 && (
                    <Command.Group heading="Templates" className={groupCls}>
                      {data!.templates.map((t) => (
                        <Command.Item key={t.id} value={`t-${t.id}`} onSelect={() => go(`/app/templates?edit=${t.id}`)} className={itemCls}>
                          <FileText />
                          <span className="flex-1 truncate">{t.name}</span>
                          <span className="max-w-[200px] truncate text-[12px] text-subtle">{t.subject}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                  {data!.notes.length > 0 && (
                    <Command.Group heading="Notes" className={groupCls}>
                      {data!.notes.map((n) => (
                        <Command.Item key={n.id} value={`n-${n.id}`} onSelect={() => go(`/app/prospects/${n.prospectId}`)} className={itemCls}>
                          <StickyNote />
                          <span className="flex-1 truncate">{n.body}</span>
                          <span className="max-w-[160px] truncate text-[12px] text-subtle">{n.prospectName ?? live.get(n.placeId)?.name ?? ''}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                </>
              ) : null}
              {q.length < 2 && (
                <>
                  <Command.Group heading="Actions" className={groupCls}>
                    {actions.map((a) => (
                      <Command.Item key={a.label} value={a.label} onSelect={() => go(a.to)} className={itemCls}>
                        <a.icon />
                        <span className="flex-1">{a.label}</span>
                        {a.shortcut && <span className="font-mono text-[11px] text-subtle">{a.shortcut}</span>}
                      </Command.Item>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Go to" className={groupCls}>
                    {nav.map((n) => (
                      <Command.Item key={n.label} value={n.label} onSelect={() => go(n.to)} className={itemCls}>
                        <n.icon />
                        {n.label}
                      </Command.Item>
                    ))}
                  </Command.Group>
                </>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
