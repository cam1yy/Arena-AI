import { useState } from 'react';
import { Info } from 'lucide-react';
import { PROSPECT_STATUS_LABELS, type CampaignStatus, type ProspectStatus } from '@localy/shared';
import { useApi } from '@/lib/query';
import { formatNumber, formatPercent } from '@/lib/utils';
import { Button, Card, CardHeader, EmptyState, SegmentedControl, Select, Skeleton } from '@/components/ui';
import { PageBody, PageHeader } from '@/components/app/page';
import { Metric, MetricGrid } from '@/components/app/metric';
import { CampaignStatusBadge } from '@/components/app/status';
import { FunnelBars, TimeChart } from '@/components/app/chart';
import { Link } from 'react-router';

interface AnalyticsData {
  metrics: {
    businessesDiscovered: number | null;
    prospectsSaved: number;
    emailsSent: number;
    delivered: number;
    deliveryRate: number | null;
    bounced: number;
    failed: number;
    contacted: number;
    replies: number;
    replyRate: number | null;
    positiveReplies: number;
    followUpsSent: number;
    conversions: number;
    conversionRate: number | null;
  };
  series: { bucket: 'day' | 'week'; points: { date: string; sent: number; replies: number; prospects: number; discovered: number }[] };
  funnel: Partial<Record<ProspectStatus, number>>;
  campaigns: { id: string; name: string; status: CampaignStatus; kind: string; recipients: number; sent: number; replies: number; positiveReplies: number; bounced: number; failed: number; replyRate: number | null }[];
  definitions: Record<string, string>;
}

export default function Analytics() {
  const [range, setRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [campaignId, setCampaignId] = useState('');
  const campaigns = useApi<{ campaigns: { id: string; name: string }[] }>(['campaigns'], '/api/campaigns');
  const { data, isLoading, error, refetch } = useApi<AnalyticsData>(['analytics', range, campaignId], `/api/analytics?range=${range}${campaignId ? `&campaignId=${campaignId}` : ''}`, { placeholderData: (p) => p });
  const m = data?.metrics;
  const d = data?.definitions ?? {};
  const noData = m && m.emailsSent === 0 && m.prospectsSaved === 0 && !m.businessesDiscovered;
  const funnelOrder: ProspectStatus[] = ['new', 'contacted', 'follow_up', 'replied', 'interested', 'client'];
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Computed from recorded activity only. Every metric is defined below its value."
        actions={
          <>
            <Select size="sm" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign" className="w-[200px]">
              <option value="">All campaigns</option>
              {campaigns.data?.campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <SegmentedControl value={range} onChange={setRange} options={[{ value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: 'all', label: 'All time' }]} />
          </>
        }
      />
      <PageBody className="space-y-6">
        {error && <EmptyState compact title="Analytics could not be loaded" description={error.message} action={<Button onClick={() => refetch()}>Try again</Button>} />}
        <MetricGrid>
          {!campaignId && <Metric label="Businesses discovered" value={m?.businessesDiscovered ?? 0} loading={isLoading} hint="Unique businesses returned by your searches for the first time in this period." />}
          <Metric label="Prospects saved" value={m?.prospectsSaved} loading={isLoading} />
          <Metric label="Emails sent" value={m?.emailsSent} loading={isLoading} sub={m ? `${formatNumber(m.followUpsSent)} follow-ups` : undefined} />
          <Metric label="Delivery rate" value={m ? formatPercent(m.deliveryRate) : undefined} loading={isLoading} hint={d.delivered} sub={m ? `${formatNumber(m.bounced)} bounced, ${formatNumber(m.failed)} failed` : undefined} />
          <Metric label="Reply rate" value={m ? formatPercent(m.replyRate) : undefined} loading={isLoading} hint={d.replyRate} sub={m ? `${formatNumber(m.replies)} of ${formatNumber(m.contacted)} contacted` : undefined} />
          <Metric label="Positive replies" value={m?.positiveReplies} loading={isLoading} hint={d.positiveReplies} />
          <Metric label="Follow-ups sent" value={m?.followUpsSent} loading={isLoading} />
          <Metric label="Clients won" value={m?.conversions} loading={isLoading} hint={d.conversions} sub={m ? `${formatPercent(m.conversionRate)} of contacted` : undefined} />
          {campaignId && <Metric label="Contacted" value={m?.contacted} loading={isLoading} />}
        </MetricGrid>

        {noData && !isLoading ? (
          <EmptyState title="No activity in this period" description="Analytics appear as you discover businesses, save prospects and send outreach. Nothing here is estimated." />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Card>
              <CardHeader title="Outreach over time" description={data?.series.bucket === 'week' ? 'Grouped by week' : 'Daily'} />
              <div className="p-5">
                {isLoading || !data ? (
                  <Skeleton className="h-[240px]" />
                ) : (
                  <TimeChart
                    points={data.series.points}
                    bucket={data.series.bucket}
                    series={[
                      { key: 'sent', label: 'Emails sent', color: '#0a0a0a' },
                      { key: 'replies', label: 'Replies', color: '#9ca3af' },
                    ]}
                  />
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Prospect pipeline" description="Current status of prospects" />
              <div className="p-5">
                {isLoading || !data ? (
                  <Skeleton className="h-40" />
                ) : (
                  <FunnelBars data={funnelOrder.map((s) => ({ label: PROSPECT_STATUS_LABELS[s], value: data.funnel[s] ?? 0 }))} />
                )}
              </div>
            </Card>
            {!campaignId && (
              <Card className="lg:col-span-2">
                <CardHeader title="Discovery and prospects" />
                <div className="p-5">
                  {isLoading || !data ? (
                    <Skeleton className="h-[200px]" />
                  ) : (
                    <TimeChart
                      points={data.series.points}
                      bucket={data.series.bucket}
                      height={180}
                      series={[
                        { key: 'discovered', label: 'Businesses discovered', color: '#a3a3a3' },
                        { key: 'prospects', label: 'Prospects saved', color: '#0a0a0a' },
                      ]}
                    />
                  )}
                </div>
              </Card>
            )}
          </div>
        )}

        <Card>
          <CardHeader title="Campaign performance" />
          {isLoading ? (
            <div className="p-5"><Skeleton className="h-24" /></div>
          ) : !data?.campaigns.length ? (
            <EmptyState compact title="No campaigns in this period" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wider text-subtle">
                    <th className="px-5 py-2 font-medium">Campaign</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Recipients</th>
                    <th className="px-3 py-2 text-right font-medium">Sent</th>
                    <th className="px-3 py-2 text-right font-medium">Replies</th>
                    <th className="px-3 py-2 text-right font-medium">Positive</th>
                    <th className="px-3 py-2 text-right font-medium">Bounced</th>
                    <th className="px-5 py-2 text-right font-medium">Reply rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.campaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-hover/40">
                      <td className="px-5 py-2.5"><Link to={`/app/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link></td>
                      <td className="px-3 py-2.5"><CampaignStatusBadge status={c.status} /></td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(c.recipients)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(c.sent)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(c.replies)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(c.positiveReplies)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(c.bounced)}</td>
                      <td className="tabular px-5 py-2.5 text-right">{formatPercent(c.replyRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="rounded-lg border border-line bg-panel p-5">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
            <Info className="size-4" /> How these numbers are calculated
          </div>
          <dl className="grid gap-3 text-[12.5px] md:grid-cols-2">
            {Object.entries(d).map(([k, v]) => (
              <div key={k}>
                <dt className="font-medium capitalize text-ink-2">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
                <dd className="text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </PageBody>
    </>
  );
}

