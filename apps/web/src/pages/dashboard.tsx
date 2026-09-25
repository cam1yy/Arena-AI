import { Link, useNavigate } from 'react-router';
import { ArrowRight, Building2, Check, FileText, Mail, Map as MapIcon, Megaphone, Plug, Search } from 'lucide-react';
import { categoryLabel, formatRadius, type ActivityItem, type CampaignStats, type CampaignStatus, type IntegrationItem, type LocationValue } from '@localy/shared';
import { useApi } from '@/lib/query';
import { useLivePlaces } from '@/lib/places';
import { useMe } from '@/lib/session';
import { cn, formatNumber, timeAgo } from '@/lib/utils';
import { Badge, Button, Card, CardHeader, EmptyState, Progress, Skeleton } from '@/components/ui';
import { PageBody, PageHeader } from '@/components/app/page';
import { Metric, MetricGrid } from '@/components/app/metric';
import { CampaignStatusBadge } from '@/components/app/status';

interface DashboardData {
  stats: {
    totalProspects: number;
    newProspects: number;
    newStatusProspects: number;
    withoutWebsite: number;
    emailsSent: number;
    emailsSentThisWeek: number;
    emailsQueued: number;
    replies: number;
    repliesThisWeek: number;
    positiveReplies: number;
    followUpsDue: number;
    discoveredThisWeek: number;
  };
  weekSummary: { discovered: number; sent: number; replies: number; followUpsDue: number };
  campaigns: { id: string; name: string; status: CampaignStatus; stats: CampaignStats }[];
  recentSearches: { id: string; categories: string[]; keyword: string | null; location: LocationValue; resultCount: number; opportunityCount: number; createdAt: string; radiusMeters: number }[];
  recentOutreach: { id: string; subject: string; toEmail: string; status: string; sentAt: string | null; receivedAt: string | null; prospectId: string | null; prospectName: string | null; placeId: string | null; direction: 'inbound' | 'outbound'; threadId: string | null }[];
  activity: ActivityItem[];
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const me = useMe();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useApi<DashboardData>(['dashboard'], '/api/dashboard', { refetchInterval: 30_000 });
  const integrations = useApi<{ integrations: IntegrationItem[] }>(['integrations'], '/api/integrations');
  const live = useLivePlaces((data?.recentOutreach ?? []).filter((m) => !m.prospectName).map((m) => m.placeId));
  const s = data?.stats;
  const isNew = s && s.totalProspects === 0 && s.emailsSent === 0 && data.recentSearches.length === 0;
  const hasMailbox = (integrations.data?.integrations.length ?? 0) > 0;
  const week = data?.weekSummary;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${me.user.name.split(' ')[0]}`}
        description={week && !isNew ? 'Here is what is happening across your workspace.' : 'Your workspace is ready. Start by discovering businesses near you.'}
        actions={
          <>
            <Button leftIcon={<Megaphone />} onClick={() => navigate('/app/campaigns/new')}>
              Create campaign
            </Button>
            <Button variant="primary" leftIcon={<MapIcon />} onClick={() => navigate('/app/discover')}>
              Discover businesses
            </Button>
          </>
        }
      />
      <PageBody className="space-y-6">
        {error && <EmptyState compact title="The overview could not be loaded" description={error.message} action={<Button onClick={() => refetch()}>Try again</Button>} />}

        {isNew && (
          <Card className="overflow-hidden">
            <div className="grid md:grid-cols-[1.2fr_1fr]">
              <div className="p-6">
                <h2 className="text-[16px] font-semibold tracking-tight">Get set up in three steps</h2>
                <p className="mt-1 text-[13.5px] text-muted">Everything below uses real data from your workspace. Nothing is pre-filled.</p>
                <ol className="mt-5 space-y-3">
                  {[
                    { done: hasMailbox, title: 'Connect your email', body: 'Send outreach from your own Gmail or Outlook account.', to: '/app/integrations', cta: 'Connect email' },
                    { done: false, title: 'Discover businesses', body: 'Search an area and save businesses without a website listed.', to: '/app/discover', cta: 'Open Discover' },
                    { done: false, title: 'Review your template', body: 'A default outreach template is ready for you to personalize.', to: '/app/templates', cta: 'Edit templates' },
                  ].map((step, i) => (
                    <li key={step.title} className="flex items-start gap-3">
                      <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold', step.done ? 'border-ink bg-ink text-white' : 'border-line-strong text-muted')}>{step.done ? <Check className="size-3" strokeWidth={3} /> : i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className={cn('text-[13.5px] font-medium', step.done && 'text-muted line-through')}>{step.title}</div>
                        <div className="text-[12.5px] text-muted">{step.body}</div>
                      </div>
                      {!step.done && (
                        <Button size="xs" asChild>
                          <Link to={step.to}>{step.cta}</Link>
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
              <div className="hidden border-l border-line bg-wash/50 p-6 md:block">
                <div className="text-[12px] font-medium uppercase tracking-wider text-subtle">How Localy decides</div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">Localy shows the facts from each Google Maps listing, such as "No website listed", "Strong rating" and "Phone listed". It never claims a business definitely has no website, and it never sends anything without your confirmation.</p>
              </div>
            </div>
          </Card>
        )}

        <MetricGrid>
          <Metric label="Total prospects" value={s?.totalProspects} loading={isLoading} to="/app/prospects" sub={s ? `${formatNumber(s.newProspects)} new this week` : undefined} />
          <Metric label="Without a website" value={s?.withoutWebsite} loading={isLoading} to="/app/prospects?website=opportunity" hint="Prospects whose listing shows no website, only a social profile, or a site that did not respond." />
          <Metric label="Emails sent" value={s?.emailsSent} loading={isLoading} sub={s ? `${formatNumber(s.emailsSentThisWeek)} this week${s.emailsQueued ? `, ${s.emailsQueued} queued` : ''}` : undefined} to="/app/analytics" />
          <Metric label="Replies" value={s?.replies} loading={isLoading} sub={s ? `${formatNumber(s.positiveReplies)} positive` : undefined} to="/app/inbox" hint="Prospects who replied. Positive means you marked them Interested or Client." />
          <Metric label="New prospects" value={s?.newStatusProspects} loading={isLoading} to="/app/prospects?status=new" hint="Prospects with the New status, not yet contacted." />
          <Metric label="Positive replies" value={s?.positiveReplies} loading={isLoading} to="/app/prospects?status=interested" />
          <Metric label="Follow-ups due" value={s?.followUpsDue} loading={isLoading} to="/app/follow-ups" hint="Reminders and automatic follow-ups due within 24 hours." />
          <Metric label="Discovered this week" value={s?.discoveredThisWeek} loading={isLoading} to="/app/discover" />
        </MetricGrid>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <Card>
              <CardHeader title="Campaign performance" action={<Button size="xs" variant="ghost" asChild><Link to="/app/campaigns">All campaigns <ArrowRight /></Link></Button>} />
              {isLoading ? (
                <div className="space-y-3 p-5">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              ) : !data?.campaigns.length ? (
                <EmptyState compact icon={<Megaphone />} title="No active campaigns" description="Campaigns you start, schedule or pause appear here." action={<Button size="sm" onClick={() => navigate('/app/campaigns/new')}>Create campaign</Button>} />
              ) : (
                <ul className="divide-y divide-line">
                  {data.campaigns.map((c) => {
                    const pct = c.stats.recipients ? ((c.stats.recipients - c.stats.pending) / c.stats.recipients) * 100 : 0;
                    return (
                      <li key={c.id}>
                        <Link to={`/app/campaigns/${c.id}`} className="flex flex-wrap items-center gap-4 px-5 py-3.5 hover:bg-hover/50">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[13.5px] font-medium">{c.name}</span>
                              <CampaignStatusBadge status={c.status} />
                            </div>
                            <Progress value={pct} className="mt-2 h-1 max-w-[240px]" />
                          </div>
                          <div className="tabular grid grid-cols-3 gap-6 text-right text-[12.5px]">
                            <div><div className="font-semibold text-ink">{formatNumber(c.stats.sent)}</div><div className="text-muted">sent</div></div>
                            <div><div className="font-semibold text-ink">{formatNumber(c.stats.replies)}</div><div className="text-muted">replies</div></div>
                            <div><div className="font-semibold text-ink">{formatNumber(c.stats.recipients)}</div><div className="text-muted">recipients</div></div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader title="Recent discoveries" action={<Button size="xs" variant="ghost" asChild><Link to="/app/discover?panel=history">History</Link></Button>} />
                {isLoading ? (
                  <div className="space-y-3 p-5"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
                ) : !data?.recentSearches.length ? (
                  <EmptyState compact icon={<Search />} title="No searches yet" description="Your discovery searches appear here." />
                ) : (
                  <ul className="divide-y divide-line">
                    {data.recentSearches.map((r) => (
                      <li key={r.id}>
                        <Link to={`/app/discover?history=${r.id}`} className="block px-5 py-3 hover:bg-hover/50">
                          <div className="truncate text-[13px] font-medium">{[r.keyword, ...r.categories.map(categoryLabel)].filter(Boolean).join(', ')}</div>
                          <div className="mt-0.5 truncate text-[12px] text-muted">
                            {r.location.label.split(',')[0]} &middot; {formatRadius(r.radiusMeters, me.user.distanceUnit)} &middot; {r.resultCount} found, {r.opportunityCount} opportunities &middot; {timeAgo(r.createdAt)}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <CardHeader title="Recent outreach" action={<Button size="xs" variant="ghost" asChild><Link to="/app/inbox">Inbox</Link></Button>} />
                {isLoading ? (
                  <div className="space-y-3 p-5"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
                ) : !data?.recentOutreach.length ? (
                  <EmptyState compact icon={<Mail />} title="No emails yet" description="Sent emails and replies appear here." />
                ) : (
                  <ul className="divide-y divide-line">
                    {data.recentOutreach.map((m) => (
                      <li key={m.id}>
                        <Link to={m.threadId ? `/app/inbox/${m.threadId}` : m.prospectId ? `/app/prospects/${m.prospectId}` : '/app/inbox'} className="flex items-center gap-3 px-5 py-3 hover:bg-hover/50">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium">{m.prospectName ?? live.get(m.placeId)?.name ?? m.toEmail}</div>
                            <div className="truncate text-[12px] text-muted">{m.subject}</div>
                          </div>
                          <div className="text-right">
                            <Badge tone={m.direction === 'inbound' ? 'info' : m.status === 'failed' || m.status === 'bounced' ? 'danger' : 'neutral'}>{m.direction === 'inbound' ? 'Reply' : m.status === 'sent' ? 'Sent' : m.status.charAt(0).toUpperCase() + m.status.slice(1)}</Badge>
                            <div className="mt-1 text-[11px] text-subtle">{timeAgo(m.sentAt ?? m.receivedAt)}</div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Quick actions" />
              <div className="grid grid-cols-2 gap-2 p-4">
                {[
                  { icon: MapIcon, label: 'Discover businesses', to: '/app/discover' },
                  { icon: Megaphone, label: 'Create campaign', to: '/app/campaigns/new' },
                  { icon: FileText, label: 'Create template', to: '/app/templates?new=1' },
                  { icon: Plug, label: hasMailbox ? 'Manage email' : 'Connect email', to: '/app/integrations' },
                ].map((a) => (
                  <Link key={a.label} to={a.to} className="flex flex-col gap-2 rounded-lg border border-line p-3 text-[12.5px] font-medium transition-colors hover:border-line-strong hover:bg-hover/40">
                    <a.icon className="size-4 text-muted" strokeWidth={1.8} />
                    {a.label}
                  </Link>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="This week" />
              {isLoading ? (
                <div className="space-y-2 p-5"><Skeleton className="h-4" /><Skeleton className="h-4" /></div>
              ) : (
                <ul className="space-y-2 px-5 py-4 text-[13px]">
                  <li className="flex justify-between"><span className="text-muted">Businesses discovered</span><span className="tabular font-medium">{formatNumber(week?.discovered ?? 0)}</span></li>
                  <li className="flex justify-between"><span className="text-muted">Emails sent</span><span className="tabular font-medium">{formatNumber(week?.sent ?? 0)}</span></li>
                  <li className="flex justify-between"><span className="text-muted">Replies received</span><span className="tabular font-medium">{formatNumber(week?.replies ?? 0)}</span></li>
                  <li className="flex justify-between"><span className="text-muted">Follow-ups due</span><span className="tabular font-medium">{formatNumber(week?.followUpsDue ?? 0)}</span></li>
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Activity" />
              {isLoading ? (
                <div className="space-y-3 p-5"><Skeleton className="h-4" /><Skeleton className="h-4 w-2/3" /></div>
              ) : !data?.activity.length ? (
                <EmptyState compact icon={<Building2 />} title="No activity yet" description="Discoveries, emails and replies will appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  {data.activity.map((a) => (
                    <li key={a.id} className="px-5 py-2.5">
                      {a.prospectId ? (
                        <Link to={`/app/prospects/${a.prospectId}`} className="block text-[12.5px] text-ink-2 hover:text-ink">{a.summary}</Link>
                      ) : a.campaignId ? (
                        <Link to={`/app/campaigns/${a.campaignId}`} className="block text-[12.5px] text-ink-2 hover:text-ink">{a.summary}</Link>
                      ) : (
                        <span className="block text-[12.5px] text-ink-2">{a.summary}</span>
                      )}
                      <span className="text-[11px] text-subtle">{timeAgo(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}

