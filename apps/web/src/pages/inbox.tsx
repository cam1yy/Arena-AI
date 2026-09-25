import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Archive, ArrowLeft, CornerDownLeft, Inbox as InboxIcon, Mail, MailOpen, RotateCcw, Search, Send, StickyNote, StopCircle, Tag, ThumbsUp, FlaskConical } from 'lucide-react';
import { PROSPECT_STATUS_LABELS, type MessageItem, type ProspectListItem, type ThreadItem } from '@localy/shared';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useLivePlaces } from '@/lib/places';
import { useSession } from '@/lib/session';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { Badge, Button, Dialog, EmptyState, Field, Input, SegmentedControl, Skeleton, Textarea, Tooltip } from '@/components/ui';
import { ProspectStatusBadge, WebsiteStatusBadge } from '@/components/app/status';

interface ThreadDetail {
  thread: { id: string; subject: string; status: 'open' | 'archived'; prospectId: string | null; campaignId: string | null; lastMessageAt: string };
  messages: MessageItem[];
  integration: { id: string; email: string; provider: string; status: string } | null;
  campaign: { id: string; name: string; status: string } | null;
}

function ThreadList({ activeId }: { activeId?: string }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'open' | 'archived'>('open');
  const [filter, setFilter] = useState<'all' | 'replied' | 'unread'>('all');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading } = useApi<{ items: ThreadItem[]; total: number }>(['inbox', status, filter, debounced], `/api/inbox?status=${status}&filter=${filter}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`, { refetchInterval: 20_000 });
  const live = useLivePlaces((data?.items ?? []).filter((t) => !t.prospectName).map((t) => t.placeId));
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2.5 border-b border-line p-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[15px] font-semibold">Inbox</h1>
          <SegmentedControl size="sm" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'archived', label: 'Archived' }]} />
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" leftIcon={<Search />} className="h-8" aria-label="Search conversations" />
        <div className="flex gap-1">
          {(['all', 'replied', 'unread'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cn('h-6 rounded-[5px] px-2 text-[12px] font-medium capitalize transition-colors', filter === f ? 'bg-ink text-white' : 'text-muted hover:bg-hover hover:text-ink')}>
              {f === 'all' ? 'All' : f === 'replied' ? 'Has replies' : 'Unread'}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        ) : !data?.items.length ? (
          <EmptyState compact icon={<InboxIcon />} title={status === 'archived' ? 'No archived conversations' : 'No conversations yet'} description={status === 'archived' ? undefined : 'Conversations appear here once you send outreach. Replies are detected automatically.'} />
        ) : (
          <ul>
            {data.items.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => navigate(`/app/inbox/${t.id}`)} className={cn('block w-full border-b border-line px-4 py-3 text-left transition-colors', activeId === t.id ? 'bg-wash' : 'hover:bg-hover/50')}>
                  <div className="flex items-center gap-2">
                    {t.unread && <span className="size-1.5 shrink-0 rounded-full bg-ink" aria-label="Unread" />}
                    <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', t.unread ? 'font-semibold' : 'font-medium')}>{t.prospectName || live.get(t.placeId)?.name || 'Business on Google Maps'}</span>
                    <span className="shrink-0 text-[11.5px] text-subtle">{timeAgo(t.lastMessageAt)}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-ink-2">{t.subject}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                      {t.lastDirection === 'outbound' && 'You: '}
                      {t.lastMessagePreview.split('\n--\n')[0]}
                    </span>
                    {t.prospectStatus && t.lastDirection === 'inbound' && <ProspectStatusBadge status={t.prospectStatus} />}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Conversation({ id }: { id: string }) {
  const navigate = useNavigate();
  const { config } = useSession();
  const { data, isLoading, error } = useApi<ThreadDetail>(['thread', id], `/api/inbox/${id}`, { refetchInterval: 20_000 });
  const prospect = useApi<{ prospect: ProspectListItem; notes: { id: string; body: string; createdAt: string }[] }>(['prospect', data?.thread.prospectId], data?.thread.prospectId ? `/api/prospects/${data.thread.prospectId}` : null);
  const [reply, setReply] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [tag, setTag] = useState('');
  const [simOpen, setSimOpen] = useState(false);
  const [simBody, setSimBody] = useState('Thanks for reaching out. Yes, I would like to see an example.');
  const pid = data?.thread.prospectId;
  const inv = [['thread', id], ['inbox'], ['prospect', pid], ['prospects'], ['dashboard']] as unknown[][];
  const send = useAction(() => api.post(`/api/inbox/${id}/reply`, { body: reply }), { success: 'Reply sent', invalidate: inv, onSuccess: () => setReply('') });
  const setStatus = useAction((status: 'open' | 'archived') => api.post(`/api/inbox/${id}/status`, { status }), { success: (_r, s) => (s === 'archived' ? 'Conversation archived' : 'Moved to inbox'), invalidate: inv, onSuccess: (_r, s) => s === 'archived' && navigate('/app/inbox') });
  const unread = useAction(() => api.post(`/api/inbox/${id}/unread`), { success: 'Marked unread', invalidate: [['inbox']], onSuccess: () => navigate('/app/inbox') });
  const markInterested = useAction(() => api.patch(`/api/prospects/${pid}`, { status: 'interested' }), { success: 'Marked interested', invalidate: inv });
  const addNote = useAction(() => api.post(`/api/prospects/${pid}/notes`, { body: note }), { success: 'Note added', invalidate: inv, onSuccess: () => { setNote(''); setNoteOpen(false); } });
  const addTag = useAction(() => api.post(`/api/prospects/${pid}/tags`, { name: tag }), { success: 'Tag added', invalidate: [...inv, ['tags']], onSuccess: () => { setTag(''); setTagOpen(false); } });
  const stop = useAction(() => api.post<{ stopped: number }>(`/api/prospects/${pid}/stop-sequence`, { campaignId: data?.thread.campaignId ?? undefined }), { success: (r) => (r.stopped ? 'Campaign stopped for this prospect' : 'No active sequence for this prospect'), invalidate: inv });
  const simulate = useAction((bounce: boolean) => api.post(`/api/inbox/${id}/simulate-reply`, { body: simBody, bounce }), { success: 'Simulated message recorded', invalidate: inv, onSuccess: () => setSimOpen(false) });

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  if (error || !data) return <EmptyState title="Conversation not found" description={error?.message} />;
  const p = prospect.data?.prospect;
  const canReply = data.integration?.status === 'active';

  return (
    <div className="grid h-full min-h-0 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <Button size="icon-sm" variant="ghost" className="lg:hidden" aria-label="Back to inbox" onClick={() => navigate('/app/inbox')}>
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold" title={data.thread.subject}>{data.thread.subject}</h2>
            <div className="truncate text-[12px] text-muted">
              {data.campaign && (
                <>
                  <Link to={`/app/campaigns/${data.campaign.id}`} className="hover:underline">{data.campaign.name}</Link> &middot;{' '}
                </>
              )}
              via {data.integration?.email ?? 'disconnected mailbox'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {pid && p?.status !== 'interested' && (
              <Button size="sm" leftIcon={<ThumbsUp />} onClick={() => markInterested.mutate(undefined)}>
                Mark interested
              </Button>
            )}
            {pid && (
              <>
                <Tooltip content="Add note"><Button size="icon-sm" variant="ghost" aria-label="Add note" onClick={() => setNoteOpen(true)}><StickyNote /></Button></Tooltip>
                <Tooltip content="Add tag"><Button size="icon-sm" variant="ghost" aria-label="Add tag" onClick={() => setTagOpen(true)}><Tag /></Button></Tooltip>
                <Tooltip content="Stop campaign for this prospect"><Button size="icon-sm" variant="ghost" aria-label="Stop campaign for this prospect" onClick={() => stop.mutate(undefined)}><StopCircle /></Button></Tooltip>
              </>
            )}
            <Tooltip content="Mark unread"><Button size="icon-sm" variant="ghost" aria-label="Mark unread" onClick={() => unread.mutate(undefined)}><MailOpen /></Button></Tooltip>
            {data.thread.status === 'open' ? (
              <Tooltip content="Archive"><Button size="icon-sm" variant="ghost" aria-label="Archive" onClick={() => setStatus.mutate('archived')}><Archive /></Button></Tooltip>
            ) : (
              <Tooltip content="Move to inbox"><Button size="icon-sm" variant="ghost" aria-label="Move to inbox" onClick={() => setStatus.mutate('open')}><RotateCcw /></Button></Tooltip>
            )}
            {config?.features.devSandbox && data.integration?.provider === 'sandbox' && (
              <Tooltip content="Development: simulate an inbound reply"><Button size="icon-sm" variant="ghost" aria-label="Simulate reply" onClick={() => setSimOpen(true)}><FlaskConical /></Button></Tooltip>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-wash/30 px-5 py-5">
          {data.messages.map((m) => (
            <article key={m.id} className={cn('rounded-lg border bg-panel shadow-xs', m.direction === 'inbound' ? 'border-line-strong' : 'border-line')}>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', m.direction === 'inbound' ? 'bg-wash text-ink ring-1 ring-line' : 'bg-ink text-white')} aria-label={m.direction === 'inbound' ? 'Received' : 'Sent'}>
                    {m.direction === 'inbound' ? <CornerDownLeft className="size-3" /> : <Send className="size-3" />}
                  </span>
                  <span className="truncate text-[12.5px] font-medium">{m.direction === 'inbound' ? (m.fromName ?? m.fromEmail) : m.fromEmail}</span>
                  <span className="truncate text-[12px] text-muted">to {m.toEmail}</span>
                </div>
                <div className="flex items-center gap-2">
                  {m.status !== 'sent' && m.status !== 'received' && <Badge tone={m.status === 'failed' || m.status === 'bounced' ? 'danger' : 'outline'}>{m.status}</Badge>}
                  {m.stepPosition !== null && m.stepPosition > 0 && <Badge tone="outline">Follow-up {m.stepPosition}</Badge>}
                  <span className="text-[11.5px] text-subtle">{formatDateTime(m.sentAt ?? m.receivedAt ?? m.createdAt)}</span>
                </div>
              </header>
              <div className="whitespace-pre-wrap break-words px-4 py-3.5 text-[13.5px] leading-[1.65]">
                {(() => {
                  const [main, ...footer] = m.bodyText.split('\n--\n');
                  return (
                    <>
                      {main}
                      {footer.length > 0 && <span className="mt-3 block break-all border-t border-line pt-2.5 text-[11.5px] leading-relaxed text-muted">{footer.join('\n--\n')}</span>}
                    </>
                  );
                })()}
              </div>
              {m.error && <div className="border-t border-line px-4 py-2 text-[12px] text-danger">{m.error}</div>}
            </article>
          ))}
        </div>
        <div className="border-t border-line bg-panel p-4">
          {canReply ? (
            <>
              <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} placeholder="Write a reply..." aria-label="Reply" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && reply.trim()) send.mutate(undefined); }} />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11.5px] text-subtle">Sent from {data.integration?.email}. Ctrl + Enter to send.</span>
                <Button variant="primary" size="sm" leftIcon={<Send />} disabled={!reply.trim()} loading={send.isPending} onClick={() => send.mutate(undefined)}>
                  Send reply
                </Button>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-muted">
              Reconnect the mailbox to reply. <Link to="/app/integrations" className="font-medium text-ink hover:underline">Go to integrations</Link>
            </p>
          )}
        </div>
      </div>
      <aside className="hidden min-h-0 overflow-y-auto border-l border-line bg-panel xl:block">
        {!pid ? (
          <p className="p-5 text-[13px] text-muted">This conversation is not linked to a prospect.</p>
        ) : prospect.isLoading || !p ? (
          <div className="space-y-3 p-5"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4" /><Skeleton className="h-4" /></div>
        ) : (
          <div className="space-y-5 p-5">
            <div>
              <Link to={`/app/prospects/${p.id}`} className="text-[15px] font-semibold hover:underline">{p.displayName}</Link>
              <div className="mt-1 text-[12.5px] text-muted first-letter:uppercase">{[p.categoryLabel ?? p.live?.category, p.locationLabel ?? p.live?.locality].filter(Boolean).join(' \u00b7 ')}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <ProspectStatusBadge status={p.status} />
                <WebsiteStatusBadge status={p.websiteStatus} socialOnly={p.socialProfileOnly} />
              </div>
            </div>
            <dl className="space-y-2 text-[12.5px]">
              <div><dt className="text-muted">Contact</dt><dd>{p.contactName ?? 'Not set'}</dd></div>
              <div><dt className="text-muted">Email</dt><dd className="break-all">{p.email ?? 'Not set'}</dd></div>
              <div><dt className="text-muted">Phone</dt><dd>{p.phone ?? p.live?.internationalPhone ?? p.live?.phone ?? 'Not listed'}</dd></div>
              {p.live?.address && <div><dt className="text-muted">Address</dt><dd>{p.live.address}</dd></div>}
              {p.live?.rating != null && <div><dt className="text-muted">Rating</dt><dd>{p.live.rating.toFixed(1)} ({p.live.userRatingCount} reviews)</dd></div>}
            </dl>
            {p.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.tags.map((t) => <Badge key={t.id} tone="outline">{t.name}</Badge>)}
              </div>
            )}
            <div>
              <div className="mb-2 text-[11.5px] font-medium uppercase tracking-wider text-subtle">Recent notes</div>
              {prospect.data?.notes.length ? (
                <ul className="space-y-2">
                  {prospect.data.notes.slice(0, 4).map((n) => (
                    <li key={n.id} className="rounded-md border border-line p-2.5 text-[12.5px]">
                      <p className="whitespace-pre-line">{n.body}</p>
                      <p className="mt-1 text-[11px] text-subtle">{timeAgo(n.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-muted">No notes yet.</p>
              )}
            </div>
            <Button size="sm" className="w-full" asChild>
              <Link to={`/app/prospects/${p.id}`}>Open prospect</Link>
            </Button>
            <p className="text-[11px] text-subtle">Status: {PROSPECT_STATUS_LABELS[p.status]}</p>
          </div>
        )}
      </aside>
      <Dialog open={noteOpen} onOpenChange={setNoteOpen} title="Add note" size="sm" footer={<><Button onClick={() => setNoteOpen(false)}>Cancel</Button><Button variant="primary" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate(undefined)}>Add note</Button></>}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} autoFocus aria-label="Note" />
      </Dialog>
      <Dialog open={tagOpen} onOpenChange={setTagOpen} title="Add tag" size="sm" footer={<><Button onClick={() => setTagOpen(false)}>Cancel</Button><Button variant="primary" disabled={!tag.trim()} loading={addTag.isPending} onClick={() => addTag.mutate(undefined)}>Add tag</Button></>}>
        <Input value={tag} onChange={(e) => setTag(e.target.value)} autoFocus placeholder="Interested" maxLength={40} aria-label="Tag" />
      </Dialog>
      <Dialog open={simOpen} onOpenChange={setSimOpen} title="Simulate an inbound message" description="Development sandbox only. Records a reply exactly as if the prospect had answered, so you can test reply detection and stop-on-reply." footer={<><Button onClick={() => simulate.mutate(true)} loading={simulate.isPending && simulate.variables === true}>Simulate bounce</Button><Button variant="primary" onClick={() => simulate.mutate(false)} loading={simulate.isPending && simulate.variables === false} disabled={!simBody.trim()}>Simulate reply</Button></>}>
        <Field label="Reply text"><Textarea value={simBody} onChange={(e) => setSimBody(e.target.value)} rows={4} /></Field>
      </Dialog>
    </div>
  );
}

export default function InboxPage() {
  const { id } = useParams();
  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className={cn('min-h-0 border-r border-line bg-panel', id ? 'hidden lg:block' : 'block')}>
        <ThreadList activeId={id} />
      </div>
      <div className={cn('min-h-0', id ? 'block' : 'hidden lg:block')}>
        {id ? <Conversation id={id} /> : <EmptyState icon={<Mail />} title="Select a conversation" description="Replies to your outreach are matched to prospects automatically and stop follow-ups when configured." />}
      </div>
    </div>
  );
}
