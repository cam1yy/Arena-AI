import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Megaphone, Plus } from 'lucide-react';
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUSES, type CampaignItem } from '@localy/shared';
import { useApi } from '@/lib/query';
import { formatDate, formatNumber, formatPercent } from '@/lib/utils';
import { Badge, Button, EmptyState, Progress, SkeletonRows, Tabs } from '@/components/ui';
import { PageBody, PageHeader } from '@/components/app/page';
import { CampaignStatusBadge } from '@/components/app/status';

export default function Campaigns() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const { data, isLoading, error, refetch } = useApi<{ campaigns: CampaignItem[] }>(['campaigns'], '/api/campaigns', { refetchInterval: 20_000 });
  const all = data?.campaigns ?? [];
  const list = all.filter((c) => status === 'all' || c.status === status);
  const count = (s: string) => all.filter((c) => c.status === s).length;
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Sequences of personalized emails sent in the background from your mailbox."
        actions={
          <Button variant="primary" leftIcon={<Plus />} onClick={() => navigate('/app/campaigns/new')}>
            Create campaign
          </Button>
        }
      >
        <Tabs className="mt-4 -mb-4" value={status} onValueChange={setStatus} items={[{ value: 'all', label: 'All', count: all.length }, ...CAMPAIGN_STATUSES.map((s) => ({ value: s, label: CAMPAIGN_STATUS_LABELS[s], count: count(s) }))]} />
      </PageHeader>
      <PageBody>
        {isLoading ? (
          <div className="rounded-lg border border-line bg-panel">
            <SkeletonRows rows={5} />
          </div>
        ) : error ? (
          <EmptyState title="Campaigns could not be loaded" description={error.message} action={<Button onClick={() => refetch()}>Try again</Button>} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Megaphone />}
            title={all.length ? 'No campaigns with this status' : 'No campaigns yet'}
            description={all.length ? undefined : 'Create a campaign to send a personalized sequence to a group of prospects, with automatic follow-ups.'}
            action={!all.length && <Button variant="primary" onClick={() => navigate('/app/campaigns/new')}>Create campaign</Button>}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-xs">
            <div className="hidden grid-cols-[minmax(220px,2fr)_100px_repeat(4,90px)_120px] gap-4 border-b border-line px-5 py-2 text-[11.5px] font-medium uppercase tracking-wider text-subtle md:grid">
              <span>Campaign</span>
              <span>Status</span>
              <span className="text-right">Recipients</span>
              <span className="text-right">Sent</span>
              <span className="text-right">Replies</span>
              <span className="text-right">Reply rate</span>
              <span className="text-right">Created</span>
            </div>
            <ul className="divide-y divide-line">
              {list.map((c) => {
                const contacted = c.stats.recipients - c.stats.pending;
                const progress = c.stats.recipients ? ((c.stats.recipients - c.stats.pending) / c.stats.recipients) * 100 : 0;
                const rate = c.stats.sent ? (c.stats.replies / Math.max(1, contacted)) * 100 : null;
                return (
                  <li key={c.id}>
                    <Link to={`/app/campaigns/${c.id}`} className="grid grid-cols-1 gap-2 px-5 py-3.5 transition-colors hover:bg-hover/50 md:grid-cols-[minmax(220px,2fr)_100px_repeat(4,90px)_120px] md:items-center md:gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-medium">{c.name}</span>
                          {c.steps.length > 1 && <Badge tone="outline">{c.steps.filter((s) => s.enabled).length} steps</Badge>}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Progress value={progress} className="h-1 max-w-[160px]" />
                          <span className="text-[11.5px] text-muted">{c.integration ? c.integration.email : 'No mailbox'}</span>
                        </div>
                        {c.pauseReason && c.status === 'paused' && <div className="mt-1 truncate text-[12px] text-warning">{c.pauseReason}</div>}
                      </div>
                      <div>
                        <CampaignStatusBadge status={c.status} />
                      </div>
                      <div className="tabular text-[13px] md:text-right">{formatNumber(c.stats.recipients)}</div>
                      <div className="tabular text-[13px] md:text-right">{formatNumber(c.stats.sent)}</div>
                      <div className="tabular text-[13px] md:text-right">{formatNumber(c.stats.replies)}</div>
                      <div className="tabular text-[13px] md:text-right">{formatPercent(rate !== null ? Math.round(rate * 10) / 10 : null)}</div>
                      <div className="text-[12.5px] text-muted md:text-right">{formatDate(c.createdAt)}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </PageBody>
    </>
  );
}
