import { useState } from 'react';
import { Link } from 'react-router';
import { CalendarClock, Check, X } from 'lucide-react';
import type { FollowUpItem } from '@localy/shared';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useLivePlaces } from '@/lib/places';
import { cn, formatDateTime } from '@/lib/utils';
import { Badge, Button, EmptyState, SkeletonRows, Tabs, Tooltip } from '@/components/ui';
import { PageBody, PageHeader } from '@/components/app/page';

export default function FollowUps() {
  const [windowTab, setWindowTab] = useState<'overdue' | 'today' | 'upcoming' | 'all'>('all');
  const { data, isLoading, error, refetch } = useApi<{ items: FollowUpItem[] }>(['follow-ups', windowTab], `/api/follow-ups?window=${windowTab}`, { refetchInterval: 30_000 });
  const live = useLivePlaces((data?.items ?? []).filter((i) => !i.prospectName).map((i) => i.placeId));
  const update = useAction((v: { id: string; status: 'done' | 'cancelled' }) => api.patch(`/api/follow-ups/${v.id}`, { status: v.status }), { success: (_r, v) => (v.status === 'done' ? 'Marked done' : 'Follow-up cancelled'), invalidate: [['follow-ups'], ['dashboard']] });
  const now = Date.now();
  return (
    <>
      <PageHeader title="Follow-ups" description="Your reminders and the automatic follow-ups scheduled by campaigns.">
        <Tabs className="mt-4 -mb-4" value={windowTab} onValueChange={(v) => setWindowTab(v as typeof windowTab)} items={[{ value: 'all', label: 'All scheduled' }, { value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Due today' }, { value: 'upcoming', label: 'Upcoming' }]} />
      </PageHeader>
      <PageBody width="narrow">
        {isLoading ? (
          <div className="rounded-lg border border-line bg-panel"><SkeletonRows rows={5} /></div>
        ) : error ? (
          <EmptyState title="Follow-ups could not be loaded" description={error.message} action={<Button onClick={() => refetch()}>Try again</Button>} />
        ) : !data?.items.length ? (
          <EmptyState icon={<CalendarClock />} title="Nothing scheduled" description="Schedule a reminder from any prospect, or add follow-up emails to a campaign sequence." />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel shadow-xs">
            {data.items.map((f) => {
              const overdue = new Date(f.dueAt).getTime() < now;
              return (
                <li key={`${f.kind}-${f.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <CalendarClock className={cn('size-4 shrink-0', overdue ? 'text-danger' : 'text-muted')} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/app/prospects/${f.prospectId}`} className="text-[13.5px] font-medium hover:underline">
                      {f.prospectName || live.get(f.placeId)?.name || 'Business on Google Maps'}
                    </Link>
                    <div className="mt-0.5 text-[12px] text-muted">
                      {f.kind === 'sequence' ? (
                        <>
                          Automatic email {(f.stepPosition ?? 0) + 1} in <Link to={`/app/campaigns/${f.campaignId}`} className="hover:underline">{f.campaignName}</Link>
                        </>
                      ) : (
                        f.note ?? 'Reminder'
                      )}
                      {f.note && f.kind === 'sequence' && ` \u00b7 ${f.note}`}
                    </div>
                  </div>
                  <Badge tone={f.kind === 'sequence' ? 'outline' : 'neutral'}>{f.kind === 'sequence' ? 'Campaign' : 'Reminder'}</Badge>
                  <span className={cn('tabular w-[130px] text-right text-[12.5px]', overdue ? 'font-medium text-danger' : 'text-muted')}>{overdue ? `Overdue, ${formatDateTime(f.dueAt)}` : formatDateTime(f.dueAt)}</span>
                  {f.kind === 'reminder' && (
                    <div className="flex gap-0.5">
                      <Tooltip content="Mark done"><Button size="icon-sm" variant="ghost" aria-label="Mark done" onClick={() => update.mutate({ id: f.id, status: 'done' })}><Check /></Button></Tooltip>
                      <Tooltip content="Cancel"><Button size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => update.mutate({ id: f.id, status: 'cancelled' })}><X /></Button></Tooltip>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
    </>
  );
}
