import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
  StopCircle,
  Trash2,
  X,
  Megaphone,
  Archive,
} from 'lucide-react';
import {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  RECIPIENT_STATUS_LABELS,
  type ActivityItem,
  type PlaceResult,
  type ProspectListItem,
  type ProspectStatus,
  type RecipientStatus,
  type CampaignStatus,
} from '@localy/shared';
import { api, ApiError } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useSession } from '@/lib/session';
import { cn, formatDate, formatDateTime, formatNumber, timeAgo, toLocalInputValue } from '@/lib/utils';
import { Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Notice, Skeleton, Textarea, Tooltip } from '@/components/ui';
import { ProspectStatusBadge, WebsiteStatusBadge, CampaignStatusBadge } from '@/components/app/status';
import { SignalList } from '@/components/discover/signals';
import { AddToCampaignDialog } from '@/components/prospects/add-to-campaign';

interface Detail {
  prospect: ProspectListItem;
  googleMapsUrl: string | null;
  websiteCheck: { checkedAt: string; httpStatus: number | null } | null;
  websiteUrl: string | null;
  discovery: { source: string; searchId: string | null; createdAt: string; analysisUpdatedAt: string | null };
  notes: { id: string; body: string; createdAt: string; updatedAt: string; author: { id: string; name: string } | null }[];
  activity: ActivityItem[];
  campaigns: { recipientId: string; campaignId: string; name: string; campaignStatus: CampaignStatus; status: RecipientStatus; currentStep: number; nextSendAt: string | null; addedAt: string; kind: string }[];
  messages: { id: string; direction: 'inbound' | 'outbound'; status: string; subject: string; toEmail: string; fromEmail: string; bodyText: string; sentAt: string | null; receivedAt: string | null; scheduledFor: string | null; error: string | null; threadId: string | null; campaignId: string | null; stepPosition: number | null; createdAt: string }[];
  followUps: { id: string; dueAt: string; note: string | null; status: string; completedAt: string | null }[];
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 px-5 py-2.5 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children ?? <span className="text-subtle">Not available</span>}</dd>
    </div>
  );
}

function ContactEditor({ p, onClose }: { p: ProspectListItem; onClose: () => void }) {
  const [form, setForm] = useState({
    name: p.name ?? '',
    contactFirstName: p.contactName?.split(' ')[0] ?? '',
    contactLastName: p.contactName?.split(' ').slice(1).join(' ') ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
    locationLabel: p.locationLabel ?? '',
    categoryLabel: p.categoryLabel ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const save = useAction((f: typeof form) => api.patch(`/api/prospects/${p.id}`, f), {
    success: 'Contact details saved',
    invalidate: [['prospect', p.id], ['prospects']],
    onSuccess: onClose,
    onError: (e: ApiError) => setErrors(e.fields),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit contact details"
      description="These are your own notes about the business. They are used for personalization and override the Google Maps listing."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" htmlFor="c-name" hint={p.placeId ? 'Leave blank to use the Google Maps listing name.' : undefined} className="sm:col-span-2" error={errors.name}>
          <Input id="c-name" value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Contact first name" htmlFor="c-first" hint="Used for {{firstName}}" error={errors.contactFirstName}>
          <Input id="c-first" value={form.contactFirstName} onChange={set('contactFirstName')} />
        </Field>
        <Field label="Contact last name" htmlFor="c-last" error={errors.contactLastName}>
          <Input id="c-last" value={form.contactLastName} onChange={set('contactLastName')} />
        </Field>
        <Field label="Email" htmlFor="c-email" error={errors.email} hint="Google Maps does not provide email addresses.">
          <Input id="c-email" type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Phone" htmlFor="c-phone" error={errors.phone}>
          <Input id="c-phone" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="Category" htmlFor="c-cat" hint="Used for {{category}}">
          <Input id="c-cat" value={form.categoryLabel} onChange={set('categoryLabel')} />
        </Field>
        <Field label="Location" htmlFor="c-loc" hint="Used for {{location}}">
          <Input id="c-loc" value={form.locationLabel} onChange={set('locationLabel')} />
        </Field>
      </div>
    </Dialog>
  );
}

function Timeline({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <p className="px-5 py-6 text-[13px] text-muted">No activity yet.</p>;
  return (
    <ol className="relative px-5 py-4">
      <span className="absolute bottom-6 left-[27px] top-6 w-px bg-line" aria-hidden />
      {items.map((a) => (
        <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
          <span className={cn('relative z-10 mt-1 size-[9px] shrink-0 rounded-full border-2 border-panel', a.type === 'reply_received' ? 'bg-positive' : a.type.includes('fail') || a.type.includes('bounce') ? 'bg-danger' : 'bg-ink')} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ink">{a.summary}</div>
            <div className="mt-0.5 text-[11.5px] text-muted">
              {formatDateTime(a.createdAt)}
              {a.actor && ` \u00b7 ${a.actor.name}`}
            </div>
            {a.type === 'note_added' && typeof a.data.preview === 'string' && <div className="mt-1 line-clamp-2 text-[12.5px] text-muted">{a.data.preview}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function ProspectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { config } = useSession();
  const { data, isLoading, error, refetch } = useApi<Detail>(['prospect', id], `/api/prospects/${id}`);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [editingNote, setEditingNote] = useState<{ id: string; body: string } | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [followOpen, setFollowOpen] = useState(false);
  const [followDue, setFollowDue] = useState(() => toLocalInputValue(new Date(Date.now() + 3 * 86_400_000)));
  const [followNote, setFollowNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const inv = [['prospect', id], ['prospects']] as unknown[][];

  const setStatus = useAction((status: ProspectStatus) => api.patch(`/api/prospects/${id}`, { status }), { success: (_r, s) => `Marked ${PROSPECT_STATUS_LABELS[s].toLowerCase()}`, invalidate: inv });
  const addNote = useAction((body: string) => api.post(`/api/prospects/${id}/notes`, { body }), { success: 'Note added', invalidate: inv, onSuccess: () => setNote('') });
  const updateNote = useAction((n: { id: string; body: string }) => api.patch(`/api/notes/${n.id}`, { body: n.body }), { success: 'Note updated', invalidate: inv, onSuccess: () => setEditingNote(null) });
  const deleteNote = useAction((nid: string) => api.delete(`/api/notes/${nid}`), { success: 'Note deleted', invalidate: inv });
  const addTag = useAction((name: string) => api.post(`/api/prospects/${id}/tags`, { name }), { invalidate: [...inv, ['tags']], onSuccess: () => setTagInput('') });
  const removeTag = useAction((tagId: string) => api.delete(`/api/prospects/${id}/tags/${tagId}`), { invalidate: [...inv, ['tags']] });
  const schedule = useAction(() => api.post('/api/follow-ups', { prospectId: id, dueAt: new Date(followDue).toISOString(), note: followNote || null }), {
    success: 'Follow-up scheduled',
    invalidate: [...inv, ['follow-ups']],
    onSuccess: () => {
      setFollowOpen(false);
      setFollowNote('');
    },
  });
  const updateFollow = useAction((v: { id: string; status: 'done' | 'cancelled' }) => api.patch(`/api/follow-ups/${v.id}`, { status: v.status }), { invalidate: [...inv, ['follow-ups']] });
  const stopSeq = useAction((campaignId?: string) => api.post<{ stopped: number }>(`/api/prospects/${id}/stop-sequence`, { campaignId }), { success: (r) => (r.stopped ? 'Sequence stopped' : 'No active sequence to stop'), invalidate: inv });
  const del = useAction(() => api.delete(`/api/prospects/${id}`), { success: 'Prospect deleted', invalidate: [['prospects']], onSuccess: () => navigate('/app/prospects') });
  const checkSite = useAction((url: string) => api.post<{ results: { status: string; reason: string }[] }>('/api/discovery/verify-websites', { items: [{ placeId: data!.prospect.placeId!, url }] }), {
    success: (r) => r.results[0]?.reason ?? 'Website checked',
    invalidate: inv,
  });
  const summarize = useAction(() => api.post<{ text: string }>('/api/ai', { task: 'summarize_notes', prospectId: id }), { onSuccess: (r) => setAiSummary(r.text) });

  useEffect(() => setAiSummary(null), [id]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] px-8 py-8">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-7 w-72" />
        <Skeleton className="mt-2 h-4 w-48" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (error || !data) {
    return <EmptyState title={error?.status === 404 ? 'Prospect not found' : 'Prospect could not be loaded'} description={error?.message} action={<Button onClick={() => navigate('/app/prospects')}>Back to prospects</Button>} />;
  }

  const p = data.prospect;
  const live: PlaceResult | null = p.live;
  const displayName = p.displayName;
  const category = p.categoryLabel ?? live?.category;
  const location = p.locationLabel ?? live?.locality ?? live?.shortAddress;
  const activeSeq = data.campaigns.filter((c) => c.status === 'pending' || c.status === 'in_progress');
  const lastThread = data.messages.find((m) => m.threadId)?.threadId;

  return (
    <div className="page-enter">
      <div className="border-b border-line bg-canvas px-5 pb-5 pt-5 md:px-8">
        <Link to="/app/prospects" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> Prospects
        </Link>
        <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{displayName}</h1>
              <ProspectStatusBadge status={p.status} />
              {p.unsubscribed && <Badge tone="danger">Unsubscribed</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
              {category && <span className="first-letter:uppercase">{category}</span>}
              {category && location && <span aria-hidden>&middot;</span>}
              {location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {location}
                </span>
              )}
              {live?.rating != null && (
                <>
                  <span aria-hidden>&middot;</span>
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-3.5 fill-current" /> {live.rating.toFixed(1)} ({formatNumber(live.userRatingCount ?? 0)} reviews)
                  </span>
                </>
              )}
            </div>
            {p.tags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                {p.tags.map((t) => (
                  <Badge key={t.id} tone="outline">
                    {t.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Menu>
              <MenuTrigger asChild>
                <Button>Status: {PROSPECT_STATUS_LABELS[p.status]}</Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Set status</MenuLabel>
                {PROSPECT_STATUSES.map((s) => (
                  <MenuItem key={s} icon={s === p.status ? <Check /> : <span className="size-4" />} onSelect={() => s !== p.status && setStatus.mutate(s)}>
                    {PROSPECT_STATUS_LABELS[s]}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Button leftIcon={<CalendarClock />} onClick={() => setFollowOpen(true)}>
              Follow-up
            </Button>
            <Button variant="primary" leftIcon={<Mail />} onClick={() => navigate(`/app/compose?prospects=${p.id}`)} disabled={p.unsubscribed}>
              Compose
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                  Edit contact details
                </MenuItem>
                <MenuItem icon={<Megaphone />} onSelect={() => setCampaignOpen(true)}>
                  Add to campaign
                </MenuItem>
                {activeSeq.length > 0 && (
                  <MenuItem icon={<StopCircle />} onSelect={() => stopSeq.mutate(undefined)}>
                    Stop all sequences
                  </MenuItem>
                )}
                {data.googleMapsUrl && (
                  <MenuItem icon={<ExternalLink />} onSelect={() => window.open(data.googleMapsUrl!, '_blank', 'noopener')}>
                    Open in Google Maps
                  </MenuItem>
                )}
                <MenuSeparator />
                <MenuItem icon={<Archive />} onSelect={() => setStatus.mutate('archived')}>
                  Archive
                </MenuItem>
                <MenuItem icon={<Trash2 />} destructive onSelect={() => setConfirmDelete(true)}>
                  Delete prospect
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1280px] gap-6 px-5 py-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {p.liveError && (
            <Notice tone="warning" title="Live business details unavailable">
              {p.liveError} Your own notes and contact details are shown below.
            </Notice>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader title="Contact information" action={<Button size="xs" variant="ghost" leftIcon={<Pencil />} onClick={() => setEditing(true)}>Edit</Button>} />
              <dl className="divide-y divide-line py-1">
                <Row label="Contact">{p.contactName}</Row>
                <Row label="Email">
                  {p.email ? (
                    <a href={`mailto:${p.email}`} className="hover:underline">
                      {p.email}
                    </a>
                  ) : (
                    <button type="button" onClick={() => setEditing(true)} className="text-ink underline-offset-2 hover:underline">
                      Add email address
                    </button>
                  )}
                </Row>
                <Row label="Phone">{p.phone ?? live?.internationalPhone ?? live?.phone}</Row>
              </dl>
            </Card>
            <Card>
              <CardHeader title="Website" action={p.placeId && live?.websiteUri ? <Tooltip content="One lightweight request to see if the site responds"><Button size="xs" variant="ghost" leftIcon={<ShieldCheck />} loading={checkSite.isPending} onClick={() => checkSite.mutate(live.websiteUri!)}>Check</Button></Tooltip> : undefined} />
              <dl className="divide-y divide-line py-1">
                <Row label="Status">
                  <WebsiteStatusBadge status={p.websiteStatus} socialOnly={p.socialProfileOnly} />
                </Row>
                <Row label="Listed URL">
                  {live?.websiteUri || data.websiteUrl ? (
                    <a href={(live?.websiteUri ?? data.websiteUrl)!} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all hover:underline">
                      <Globe className="size-3.5 shrink-0" /> {(live?.websiteUri ?? data.websiteUrl)!.replace(/^https?:\/\//, '')}
                    </a>
                  ) : (
                    <span className="text-muted">No website listed</span>
                  )}
                </Row>
                {data.websiteCheck && <Row label="Last checked">{`${formatDateTime(data.websiteCheck.checkedAt)}${data.websiteCheck.httpStatus ? ` (HTTP ${data.websiteCheck.httpStatus})` : ''}`}</Row>}
              </dl>
            </Card>
          </div>

          {p.placeId && (
            <Card>
              <CardHeader title="Business information" description="Loaded live from Google Maps. Localy does not store these details." action={<span className="gmp-attribution" translate="no">Google Maps</span>} />
              {live ? (
                <dl className="divide-y divide-line py-1">
                  <Row label="Listing name">{live.name}</Row>
                  <Row label="Category">{live.category}</Row>
                  <Row label="Address">{live.address}</Row>
                  <Row label="Rating">{live.rating != null ? `${live.rating.toFixed(1)} from ${formatNumber(live.userRatingCount ?? 0)} reviews` : null}</Row>
                  <Row label="Status">{live.businessStatus ? live.businessStatus.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null}</Row>
                  <Row label="Hours">
                    {live.weekdayHours ? (
                      <ul className="space-y-0.5">
                        {live.weekdayHours.map((h) => (
                          <li key={h}>{h}</li>
                        ))}
                      </ul>
                    ) : null}
                  </Row>
                  {data.googleMapsUrl && (
                    <Row label="Map">
                      <a href={data.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                        Open in Google Maps <ExternalLink className="size-3" />
                      </a>
                    </Row>
                  )}
                </dl>
              ) : (
                <div className="px-5 py-5 text-[13px] text-muted">{p.liveError ?? 'Loading...'}</div>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Email history" description={data.messages.length ? `${data.messages.length} messages` : undefined} action={lastThread ? <Button size="xs" variant="ghost" asChild><Link to={`/app/inbox/${lastThread}`}>Open conversation</Link></Button> : undefined} />
            {data.messages.length === 0 ? (
              <EmptyState compact title="No emails yet" description={p.email ? 'Compose an email or add this prospect to a campaign.' : 'Add an email address to start outreach.'} action={p.email ? <Button size="sm" variant="primary" onClick={() => navigate(`/app/compose?prospects=${p.id}`)}>Compose email</Button> : <Button size="sm" onClick={() => setEditing(true)}>Add email address</Button>} />
            ) : (
              <ul className="divide-y divide-line">
                {data.messages.map((m) => (
                  <li key={m.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge tone={m.direction === 'inbound' ? 'info' : m.status === 'failed' || m.status === 'bounced' ? 'danger' : m.status === 'sent' ? 'neutral' : 'outline'}>
                          {m.direction === 'inbound' ? 'Reply' : m.status === 'sent' ? (m.stepPosition ? `Follow-up ${m.stepPosition}` : 'Sent') : m.status.charAt(0).toUpperCase() + m.status.slice(1)}
                        </Badge>
                        <span className="truncate text-[13px] font-medium">{m.subject}</span>
                      </div>
                      <span className="shrink-0 text-[12px] text-muted">{formatDateTime(m.sentAt ?? m.receivedAt ?? m.scheduledFor ?? m.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-line text-[12.5px] text-muted">{m.bodyText.split('\n--\n')[0]}</p>
                    {m.error && <p className="mt-1 text-[12px] text-danger">{m.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Campaign history" />
            {data.campaigns.length === 0 ? (
              <EmptyState compact title="Not in any campaigns" action={<Button size="sm" onClick={() => setCampaignOpen(true)}>Add to campaign</Button>} />
            ) : (
              <ul className="divide-y divide-line">
                {data.campaigns.map((c) => (
                  <li key={c.recipientId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link to={`/app/campaigns/${c.campaignId}`} className="text-[13.5px] font-medium hover:underline">
                        {c.name}
                      </Link>
                      <div className="mt-0.5 text-[12px] text-muted">
                        Added {formatDate(c.addedAt)} &middot; {RECIPIENT_STATUS_LABELS[c.status]}
                        {c.nextSendAt && ` \u00b7 next email ${timeAgo(c.nextSendAt)}`}
                      </div>
                    </div>
                    <CampaignStatusBadge status={c.campaignStatus} />
                    {(c.status === 'pending' || c.status === 'in_progress') && (
                      <Button size="xs" variant="ghost" leftIcon={<StopCircle />} onClick={() => stopSeq.mutate(c.campaignId)}>
                        Stop
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Activity" />
            <Timeline items={data.activity} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Notes" action={config?.features.ai && data.notes.length > 1 ? <Button size="xs" variant="ghost" leftIcon={<Sparkles />} loading={summarize.isPending} onClick={() => summarize.mutate(undefined)}>Summarize</Button> : undefined} />
            <div className="p-4">
              {aiSummary && (
                <div className="mb-3 rounded-md border border-line bg-wash/60 p-3 text-[12.5px]">
                  <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-subtle">
                    AI summary (review for accuracy)
                    <button type="button" onClick={() => setAiSummary(null)} aria-label="Dismiss summary">
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <p className="whitespace-pre-line text-ink-2">{aiSummary}</p>
                </div>
              )}
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note. For example: owner seems interested, call back Tuesday." rows={3} aria-label="New note" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && note.trim()) addNote.mutate(note.trim()); }} />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11.5px] text-subtle">Ctrl + Enter to save</span>
                <Button size="sm" variant="primary" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate(note.trim())}>
                  Add note
                </Button>
              </div>
              {data.notes.length > 0 && (
                <ul className="mt-4 space-y-3">
                  {data.notes.map((n) => (
                    <li key={n.id} className="group rounded-md border border-line p-3">
                      {editingNote?.id === n.id ? (
                        <>
                          <Textarea value={editingNote.body} onChange={(e) => setEditingNote({ id: n.id, body: e.target.value })} rows={3} aria-label="Edit note" />
                          <div className="mt-2 flex justify-end gap-1.5">
                            <Button size="xs" onClick={() => setEditingNote(null)}>
                              Cancel
                            </Button>
                            <Button size="xs" variant="primary" loading={updateNote.isPending} onClick={() => updateNote.mutate(editingNote)}>
                              Save
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="whitespace-pre-line text-[13px] text-ink">{n.body}</p>
                          <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted">
                            <span>
                              {n.author?.name ?? 'Unknown'} &middot; {timeAgo(n.createdAt)}
                            </span>
                            <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                              <Button size="icon-sm" variant="ghost" aria-label="Edit note" onClick={() => setEditingNote({ id: n.id, body: n.body })}>
                                <Pencil />
                              </Button>
                              <Button size="icon-sm" variant="ghost" aria-label="Delete note" onClick={() => deleteNote.mutate(n.id)}>
                                <Trash2 />
                              </Button>
                            </span>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Tags" />
            <div className="p-4">
              <div className="flex flex-wrap gap-1.5">
                {p.tags.map((t) => (
                  <span key={t.id} className="inline-flex h-6 items-center gap-1 rounded-[5px] border border-line pl-2 pr-1 text-[12px]">
                    {t.name}
                    <button type="button" onClick={() => removeTag.mutate(t.id)} className="flex size-4 items-center justify-center rounded text-subtle hover:bg-hover hover:text-ink" aria-label={`Remove tag ${t.name}`}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                {!p.tags.length && <span className="text-[12.5px] text-muted">No tags yet.</span>}
              </div>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (tagInput.trim()) addTag.mutate(tagInput.trim());
                }}
              >
                <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Add a tag" className="h-8" maxLength={40} aria-label="New tag" list="tag-suggestions" />
                <Button size="sm" type="submit" disabled={!tagInput.trim()} loading={addTag.isPending} leftIcon={<Plus />}>
                  Add
                </Button>
              </form>
              <TagSuggestions />
            </div>
          </Card>

          <Card>
            <CardHeader title="Follow-ups" action={<Button size="xs" variant="ghost" leftIcon={<Plus />} onClick={() => setFollowOpen(true)}>Schedule</Button>} />
            <div className="p-4">
              {activeSeq.map((c) => (
                <div key={c.recipientId} className="mb-2 rounded-md border border-line p-3 text-[12.5px]">
                  <div className="font-medium">Automatic follow-up in "{c.name}"</div>
                  <div className="text-muted">{c.nextSendAt ? `Next email ${formatDateTime(c.nextSendAt)}` : 'Waiting to send'}{c.campaignStatus === 'paused' && ' (campaign paused)'}</div>
                </div>
              ))}
              {data.followUps.length === 0 && activeSeq.length === 0 ? (
                <p className="text-[12.5px] text-muted">No follow-ups scheduled.</p>
              ) : (
                <ul className="space-y-2">
                  {data.followUps.map((f) => (
                    <li key={f.id} className={cn('flex items-start gap-3 rounded-md border border-line p-3', f.status !== 'scheduled' && 'opacity-60')}>
                      <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1 text-[12.5px]">
                        <div className={cn('font-medium', f.status === 'scheduled' && new Date(f.dueAt) < new Date() && 'text-danger')}>{formatDateTime(f.dueAt)}</div>
                        {f.note && <div className="text-muted">{f.note}</div>}
                        {f.status !== 'scheduled' && <div className="text-subtle">{f.status === 'done' ? 'Done' : 'Cancelled'}</div>}
                      </div>
                      {f.status === 'scheduled' && (
                        <div className="flex gap-0.5">
                          <Tooltip content="Mark done">
                            <Button size="icon-sm" variant="ghost" aria-label="Mark follow-up done" onClick={() => updateFollow.mutate({ id: f.id, status: 'done' })}>
                              <Check />
                            </Button>
                          </Tooltip>
                          <Tooltip content="Cancel">
                            <Button size="icon-sm" variant="ghost" aria-label="Cancel follow-up" onClick={() => updateFollow.mutate({ id: f.id, status: 'cancelled' })}>
                              <X />
                            </Button>
                          </Tooltip>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Opportunity signals" description="Facts from the listing and your data, not predictions." />
            <div className="p-4">
              <SignalList signals={p.signals} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Discovery" />
            <dl className="divide-y divide-line py-1">
              <Row label="Source">{data.discovery.source === 'google_places' ? 'Google Maps (Places API)' : data.discovery.source === 'dev_seed' ? 'Development seed data' : 'Added manually'}</Row>
              <Row label="Saved">{formatDateTime(data.discovery.createdAt)}</Row>
              {data.discovery.analysisUpdatedAt && <Row label="Analyzed">{timeAgo(data.discovery.analysisUpdatedAt)}</Row>}
              {p.placeId && <Row label="Place ID"><code className="break-all font-mono text-[11.5px] text-muted">{p.placeId}</code></Row>}
            </dl>
          </Card>
        </div>
      </div>

      {editing && <ContactEditor p={p} onClose={() => setEditing(false)} />}
      <AddToCampaignDialog open={campaignOpen} onOpenChange={setCampaignOpen} prospectIds={[p.id]} onDone={() => refetch()} />
      <Dialog
        open={followOpen}
        onOpenChange={setFollowOpen}
        title="Schedule a follow-up"
        description="You'll get a reminder when it's due."
        size="sm"
        footer={
          <>
            <Button onClick={() => setFollowOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={schedule.isPending} onClick={() => schedule.mutate(undefined)}>
              Schedule
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {[1, 3, 7, 14].map((d) => (
              <Button key={d} size="xs" onClick={() => setFollowDue(toLocalInputValue(new Date(Date.now() + d * 86_400_000)))}>
                In {d} {d === 1 ? 'day' : 'days'}
              </Button>
            ))}
          </div>
          <Field label="Due" htmlFor="fu-due">
            <Input id="fu-due" type="datetime-local" value={followDue} onChange={(e) => setFollowDue(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor="fu-note" optional>
            <Input id="fu-note" value={followNote} onChange={(e) => setFollowNote(e.target.value)} placeholder="Call about the menu website" />
          </Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this prospect?"
        description="This permanently deletes the prospect, its notes, tags, activity and email history."
        confirmLabel="Delete prospect"
        destructive
        loading={del.isPending}
        onConfirm={() => del.mutate(undefined)}
      />
    </div>
  );
}

function TagSuggestions() {
  const { data } = useApi<{ tags: { id: string; name: string }[] }>(['tags'], '/api/tags');
  return (
    <datalist id="tag-suggestions">
      {data?.tags.map((t) => (
        <option key={t.id} value={t.name} />
      ))}
    </datalist>
  );
}

