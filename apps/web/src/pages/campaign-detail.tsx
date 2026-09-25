import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Copy, Info, MoreHorizontal, Pause, Pencil, Play, Plus, Square, Trash2, UserMinus } from 'lucide-react';
import { RECIPIENT_STATUS_LABELS, type CampaignItem, type RecipientItem } from '@localy/shared';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useLivePlaces } from '@/lib/places';
import { cn, formatDate, formatDateTime, formatNumber, formatPercent, pluralize, timeAgo } from '@/lib/utils';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Notice, Select, Skeleton, SkeletonRows, Tooltip } from '@/components/ui';
import { PageBody, PageHeader } from '@/components/app/page';
import { CampaignStatusBadge } from '@/components/app/status';
import { Metric, MetricGrid } from '@/components/app/metric';

interface Readiness {
  total: number;
  sendable: number;
  missingEmail: number;
  suppressed: number;
  enabledSteps: number;
  maxEmails: number;
  remainingMonthly: number;
  willExceedMonthly: boolean;
  problems: string[];
  ready: boolean;
}

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recStatus, setRecStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading, error } = useApi<{ campaign: CampaignItem }>(['campaign', id], `/api/campaigns/${id}`, { refetchInterval: 8000 });
  const recipients = useApi<{ items: RecipientItem[]; total: number; page: number; pageSize: number }>(['campaign', id, 'recipients', recStatus, page], `/api/campaigns/${id}/recipients?status=${recStatus}&page=${page}&pageSize=50`, { refetchInterval: 10_000, placeholderData: (p) => p });
  const readiness = useApi<Readiness>(['campaign', id, 'readiness'], confirmStart ? `/api/campaigns/${id}/readiness` : null);
  const live = useLivePlaces((recipients.data?.items ?? []).filter((r) => !r.prospectName).map((r) => r.placeId));
  const inv = [['campaign', id], ['campaigns'], ['dashboard']] as unknown[][];
  const action = useAction((a: 'start' | 'pause' | 'resume' | 'complete') => api.post(`/api/campaigns/${id}/status`, { action: a, confirm: true }), {
    success: (_r, a) => ({ start: 'Campaign started', resume: 'Campaign resumed', pause: 'Campaign paused', complete: 'Campaign ended' })[a],
    invalidate: inv,
    onSuccess: () => {
      setConfirmStart(false);
      setConfirmComplete(false);
    },
  });
  const duplicate = useAction(() => api.post<{ campaign: CampaignItem }>(`/api/campaigns/${id}/duplicate`), { success: 'Campaign duplicated', invalidate: [['campaigns']], onSuccess: (r) => navigate(`/app/campaigns/${r.campaign.id}`) });
  const del = useAction(() => api.delete(`/api/campaigns/${id}`), { success: 'Campaign deleted', invalidate: [['campaigns']], onSuccess: () => navigate('/app/campaigns') });
  const removeRec = useAction((rid: string) => api.delete(`/api/campaigns/${id}/recipients/${rid}`), { success: 'Recipient removed', invalidate: inv.concat([['campaign', id, 'recipients']]) });

  if (isLoading) {
    return (
      <PageBody>
        <Skeleton className="h-7 w-72" />
        <Skeleton className="mt-6 h-24" />
        <Skeleton className="mt-6 h-64" />
      </PageBody>
    );
  }
  if (error || !data) return <EmptyState title="Campaign not found" description={error?.message} action={<Button onClick={() => navigate('/app/campaigns')}>Back to campaigns</Button>} />;

  const c = data.campaign;
  const s = c.stats;
  const contacted = s.recipients - s.pending;
  const canStart = c.status === 'draft' || c.status === 'scheduled';
  const r = readiness.data;

  return (
    <>
      <PageHeader
        title={c.name}
        breadcrumbs={[{ label: 'Campaigns', to: '/app/campaigns' }, { label: c.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <CampaignStatusBadge status={c.status} />
            <span>
              {c.integration ? `From ${c.integration.email}` : 'No mailbox selected'} &middot; {c.dailyLimit}/day &middot; {String(c.sendWindowStart).padStart(2, '0')}:00 to {String(c.sendWindowEnd).padStart(2, '0')}:00 {c.timezone}
            </span>
          </span>
        }
        actions={
          <>
            {canStart && (
              <Button variant="primary" leftIcon={<Play />} onClick={() => setConfirmStart(true)}>
                {c.status === 'scheduled' ? 'Start now' : 'Start campaign'}
              </Button>
            )}
            {c.status === 'paused' && (
              <Button variant="primary" leftIcon={<Play />} onClick={() => setConfirmStart(true)}>
                Resume
              </Button>
            )}
            {(c.status === 'active' || c.status === 'scheduled') && (
              <Button leftIcon={<Pause />} loading={action.isPending && action.variables === 'pause'} onClick={() => action.mutate('pause')}>
                Pause
              </Button>
            )}
            <Menu>
              <MenuTrigger asChild>
                <Button size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Pencil />} disabled={c.status === 'active' || c.status === 'completed'} onSelect={() => navigate(`/app/campaigns/${id}/edit`)}>
                  Edit campaign
                </MenuItem>
                <MenuItem icon={<Plus />} disabled={c.status === 'completed'} onSelect={() => setAddOpen(true)}>
                  Add recipients
                </MenuItem>
                <MenuItem icon={<Copy />} onSelect={() => duplicate.mutate(undefined)}>
                  Duplicate
                </MenuItem>
                {c.status !== 'completed' && c.status !== 'draft' && (
                  <MenuItem icon={<Square />} onSelect={() => setConfirmComplete(true)}>
                    End campaign
                  </MenuItem>
                )}
                <MenuSeparator />
                <MenuItem icon={<Trash2 />} destructive disabled={c.status === 'active'} onSelect={() => setConfirmDelete(true)}>
                  Delete campaign
                </MenuItem>
              </MenuContent>
            </Menu>
          </>
        }
      />
      <PageBody className="space-y-6">
        {c.status === 'paused' && c.pauseReason && <Notice tone="warning" title="Campaign paused">{c.pauseReason}</Notice>}
        {c.status === 'scheduled' && c.startAt && <Notice tone="info">Scheduled to start {formatDateTime(c.startAt)}.</Notice>}
        {c.status === 'active' && s.queued > 0 && <Notice tone="neutral">{pluralize(s.queued, 'email')} in the sending queue.</Notice>}

        <MetricGrid className="md:grid-cols-4 lg:grid-cols-8">
          <Metric label="Recipients" value={s.recipients} />
          <Metric label="Sent" value={s.sent} hint="Emails accepted by your mail provider." />
          <Metric label="Delivered" value={s.delivered} hint="Sent with no bounce received. Providers do not confirm inbox placement." />
          <Metric label="Replies" value={s.replies} sub={contacted ? formatPercent(Math.round((s.replies / Math.max(1, contacted)) * 1000) / 10) : undefined} />
          <Metric label="Positive" value={s.positiveReplies} hint="Replies from prospects you marked Interested or Client." />
          <Metric label="Follow-ups" value={s.followUpsSent} />
          <Metric label="Unsubscribed" value={s.unsubscribed} />
          <Metric label="Failed" value={s.failed + s.bounced} hint="Failed sends plus bounces." />
        </MetricGrid>
        <p className="-mt-3 flex items-center gap-1.5 text-[12px] text-muted">
          <Info className="size-3.5" /> Opens are not tracked. Localy reports only what your mail provider and inbox can confirm.
        </p>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardHeader
              title="Recipients"
              description={recipients.data ? `${formatNumber(recipients.data.total)} ${recStatus === 'all' ? 'total' : RECIPIENT_STATUS_LABELS[recStatus as keyof typeof RECIPIENT_STATUS_LABELS]?.toLowerCase()}` : undefined}
              action={
                <>
                  <Select size="sm" value={recStatus} onChange={(e) => { setRecStatus(e.target.value); setPage(1); }} aria-label="Filter recipients" className="w-[160px]">
                    <option value="all">All recipients</option>
                    {Object.entries(RECIPIENT_STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                  {c.status !== 'completed' && (
                    <Button size="sm" leftIcon={<Plus />} onClick={() => setAddOpen(true)}>
                      Add
                    </Button>
                  )}
                </>
              }
            />
            {recipients.isLoading ? (
              <SkeletonRows rows={5} />
            ) : !recipients.data?.items.length ? (
              <EmptyState compact title="No recipients" description="Add prospects to this campaign to start sending." action={c.status !== 'completed' && <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>Add recipients</Button>} />
            ) : (
              <>
                <ul className="divide-y divide-line">
                  {recipients.data.items.map((rec) => (
                    <li key={rec.id} className="group flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <Link to={`/app/prospects/${rec.prospectId}`} className="text-[13.5px] font-medium hover:underline">
                          {rec.prospectName || live.get(rec.placeId)?.name || 'Business on Google Maps'}
                        </Link>
                        <div className="mt-0.5 text-[12px] text-muted">
                          {rec.email ?? <Link to={`/app/prospects/${rec.prospectId}`} className="text-warning hover:underline">No email address. Add one to include this recipient.</Link>}
                          {rec.lastSentAt && ` \u00b7 last sent ${timeAgo(rec.lastSentAt)}`}
                          {rec.nextSendAt && (rec.status === 'pending' || rec.status === 'in_progress') && c.status === 'active' && ` \u00b7 next ${new Date(rec.nextSendAt) < new Date() ? 'due now' : timeAgo(rec.nextSendAt)}`}
                        </div>
                        {rec.email && rec.issues.length > 0 && (rec.status === 'pending' || rec.status === 'in_progress') && <div className="mt-0.5 text-[12px] text-warning">{rec.issues[0]}</div>}
                      </div>
                      <Tooltip content={rec.stoppedReason ?? undefined}>
                        <span>
                          <Badge tone={rec.status === 'replied' ? 'info' : rec.status === 'in_progress' ? 'neutral' : rec.status === 'bounced' || rec.status === 'failed' ? 'danger' : rec.status === 'completed' ? 'positive' : 'outline'}>
                            {RECIPIENT_STATUS_LABELS[rec.status]}
                            {rec.status === 'in_progress' && ` \u00b7 step ${rec.currentStep + 1}`}
                          </Badge>
                        </span>
                      </Tooltip>
                      {c.status !== 'completed' && (
                        <Tooltip content="Remove from campaign">
                          <Button size="icon-sm" variant="ghost" aria-label="Remove recipient" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => removeRec.mutate(rec.id)}>
                            <UserMinus />
                          </Button>
                        </Tooltip>
                      )}
                    </li>
                  ))}
                </ul>
                {recipients.data.total > 50 && (
                  <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-2.5 text-[12.5px]">
                    <Button size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      Previous
                    </Button>
                    <span className="text-muted">
                      Page {page} of {Math.ceil(recipients.data.total / 50)}
                    </span>
                    <Button size="xs" disabled={page >= Math.ceil(recipients.data.total / 50)} onClick={() => setPage((p) => p + 1)}>
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Sequence" action={c.status !== 'active' && c.status !== 'completed' ? <Button size="xs" variant="ghost" leftIcon={<Pencil />} onClick={() => navigate(`/app/campaigns/${id}/edit`)}>Edit</Button> : undefined} />
              <ol className="divide-y divide-line">
                {c.steps.map((st, i) => (
                  <li key={st.id} className={cn('px-5 py-3', !st.enabled && 'opacity-50')}>
                    <div className="flex items-center justify-between text-[12px] text-muted">
                      <span className="font-medium text-ink">Email {i + 1}</span>
                      <span>{i === 0 ? 'Day 0' : `+${st.waitDays} days`}{!st.enabled && ' (disabled)'}</span>
                    </div>
                    <div className="mt-1 truncate text-[13px]">{st.subject}</div>
                  </li>
                ))}
              </ol>
              <div className="border-t border-line px-5 py-3 text-[12px] text-muted">{c.stopOnReply ? 'Stops automatically when a prospect replies.' : 'Continues even after a reply.'}</div>
            </Card>
            <Card>
              <CardHeader title="Timeline" />
              <dl className="space-y-2 px-5 py-4 text-[12.5px]">
                <div className="flex justify-between"><dt className="text-muted">Created</dt><dd>{formatDate(c.createdAt)}</dd></div>
                {c.startAt && <div className="flex justify-between"><dt className="text-muted">Scheduled start</dt><dd>{formatDateTime(c.startAt)}</dd></div>}
                {c.startedAt && <div className="flex justify-between"><dt className="text-muted">Started</dt><dd>{formatDateTime(c.startedAt)}</dd></div>}
                {c.completedAt && <div className="flex justify-between"><dt className="text-muted">Completed</dt><dd>{formatDateTime(c.completedAt)}</dd></div>}
              </dl>
            </Card>
          </div>
        </div>
      </PageBody>

      <ConfirmDialog
        open={confirmStart}
        onOpenChange={setConfirmStart}
        title={c.status === 'paused' ? 'Resume this campaign?' : 'Start sending?'}
        description={r ? (r.ready ? `You are about to send up to ${pluralize(r.maxEmails, 'email')} to ${pluralize(r.sendable, 'recipient')} from ${c.integration?.email}. Emails go out in the background within your sending window, at most ${c.dailyLimit} per day.` : undefined) : 'Checking recipients...'}
        confirmLabel={c.status === 'paused' ? 'Resume campaign' : c.startAt && new Date(c.startAt) > new Date() ? 'Schedule campaign' : 'Start campaign'}
        loading={action.isPending}
        onConfirm={() => r?.ready && action.mutate(c.status === 'paused' ? 'resume' : 'start')}
      >
        {r && (
          <div className="space-y-2 text-[13px]">
            {r.problems.length > 0 && <Notice tone="danger">{r.problems.join(' ')}</Notice>}
            {(r.missingEmail > 0 || r.suppressed > 0) && (
              <Notice tone="warning">
                {r.missingEmail > 0 && `${pluralize(r.missingEmail, 'recipient')} without an email will be skipped. `}
                {r.suppressed > 0 && `${pluralize(r.suppressed, 'recipient')} unsubscribed or bounced and will be skipped.`}
              </Notice>
            )}
            {r.willExceedMonthly && <Notice tone="warning">You have {formatNumber(r.remainingMonthly)} emails left this month. The campaign will pause when the limit is reached.</Notice>}
          </div>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={confirmComplete} onOpenChange={setConfirmComplete} title="End this campaign?" description="No further emails or follow-ups will be sent. Replies are still tracked." confirmLabel="End campaign" loading={action.isPending} onConfirm={() => action.mutate('complete')} />
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this campaign?" description="The campaign and its recipient list are deleted. Sent emails remain in each prospect's history." confirmLabel="Delete campaign" destructive loading={del.isPending} onConfirm={() => del.mutate(undefined)} />
      <AddProspectsToCampaign open={addOpen} onOpenChange={setAddOpen} campaignId={id!} />
    </>
  );
}

function AddProspectsToCampaign({ open, onOpenChange, campaignId }: { open: boolean; onOpenChange: (o: boolean) => void; campaignId: string }) {
  const navigate = useNavigate();
  if (!open) return null;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add recipients"
      description="Select prospects on the Prospects page and choose Add to campaign. You can filter by status, tag, website status and more."
      confirmLabel="Go to prospects"
      onConfirm={() => {
        onOpenChange(false);
        navigate(`/app/prospects?campaignTarget=${campaignId}`);
      }}
    />
  );
}

