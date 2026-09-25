import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, FileText, MailCheck, Plus, Save, Send, Trash2, X, Users } from 'lucide-react';
import { INTEGRATION_PROVIDER_LABELS, type IntegrationItem, type ProspectListItem, type TemplateItem } from '@localy/shared';
import { api, qs } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useLivePlaces } from '@/lib/places';
import { useMe } from '@/lib/session';
import { cn, pluralize, toLocalInputValue, uuid } from '@/lib/utils';
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Notice, Select, Switch } from '@/components/ui';
import { PageHeader } from '@/components/app/page';
import { EmailFields, EmailPreview, VariableWarnings } from '@/components/email/editor';
import { AiAssist } from './templates';

const DRAFT_KEY = 'localy.composer.draft';

interface PreviewResponse {
  subject: string;
  body: string;
  missing: string[];
  recipient: { id: string; email: string | null; name: string | null; firstName: string | null } | null;
  liveError?: string | null;
}

interface FollowUpDraft {
  id: string;
  subject: string;
  body: string;
  waitDays: number;
}

export default function Composer() {
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialIds = useMemo(() => (params.get('prospects') ?? '').split(',').filter(Boolean).slice(0, 500), [params]);
  const [prospectIds, setProspectIds] = useState<string[]>(initialIds);
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as { subject: string; body: string; followUps: FollowUpDraft[] } | null;
    } catch {
      return null;
    }
  }, []);
  const [subject, setSubject] = useState(saved?.subject ?? '');
  const [body, setBody] = useState(saved?.body ?? '');
  const [followUps, setFollowUps] = useState<FollowUpDraft[]>(saved?.followUps ?? []);
  const [integrationId, setIntegrationId] = useState('');
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduledFor, setScheduledFor] = useState(() => toLocalInputValue(new Date(Date.now() + 86_400_000)));
  const [previewIndex, setPreviewIndex] = useState(0);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState(me.user.email);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const idempotencyKey = useRef(uuid());

  const integrations = useApi<{ integrations: IntegrationItem[] }>(['integrations'], '/api/integrations');
  const templates = useApi<{ templates: TemplateItem[] }>(['templates'], '/api/templates');
  const recipientsQuery = useApi<{ items: ProspectListItem[]; total: number }>(
    ['compose-recipients', prospectIds],
    prospectIds.length ? `/api/prospects${qs({ ids: prospectIds.join(','), pageSize: 500 })}` : null,
  );
  const recipientRows = useMemo(() => {
    const items = recipientsQuery.data?.items ?? [];
    return prospectIds.map((id) => items.find((r) => r.id === id)).filter(Boolean) as ProspectListItem[];
  }, [recipientsQuery.data, prospectIds]);
  const live = useLivePlaces(recipientRows.filter((r) => !r.name).map((r) => r.placeId));

  useEffect(() => {
    const list = integrations.data?.integrations.filter((i) => i.status === 'active') ?? [];
    if (!integrationId && list.length) setIntegrationId((list.find((i) => i.isDefault) ?? list[0]).id);
  }, [integrations.data, integrationId]);

  useEffect(() => {
    if (!subject && !body && templates.data && !saved) {
      const t = templates.data.templates.find((x) => x.kind === 'initial');
      if (t) {
        setSubject(t.subject);
        setBody(t.body);
      }
    }
  }, [templates.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist draft locally so nothing is lost on navigation.
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(DRAFT_KEY, JSON.stringify({ subject, body, followUps })), 400);
    return () => clearTimeout(t);
  }, [subject, body, followUps]);

  const current = recipientRows[Math.min(previewIndex, Math.max(0, recipientRows.length - 1))];
  useEffect(() => {
    const t = setTimeout(() => {
      setPreviewLoading(true);
      api
        .post<PreviewResponse>('/api/preview', { prospectId: current?.id ?? null, subject, body })
        .then(setPreview)
        .catch(() => undefined)
        .finally(() => setPreviewLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [current?.id, subject, body]);

  const withEmail = recipientRows.filter((r) => r.email && !r.unsubscribed);
  const skipped = recipientRows.length - withEmail.length;
  const activeIntegrations = integrations.data?.integrations.filter((i) => i.status === 'active') ?? [];
  const integration = activeIntegrations.find((i) => i.id === integrationId);

  const send = useAction(
    () =>
      api.post<{ campaign: { id: string }; duplicate: boolean }>('/api/compose/send', {
        prospectIds: withEmail.map((r) => r.id),
        integrationId,
        subject,
        body,
        scheduledFor: scheduleOn ? new Date(scheduledFor).toISOString() : null,
        followUps: followUps.map((f) => ({ subject: f.subject, body: f.body, waitDays: f.waitDays })),
        idempotencyKey: idempotencyKey.current,
      }),
    {
      invalidate: [['campaigns'], ['prospects'], ['dashboard']],
      onSuccess: (r) => {
        localStorage.removeItem(DRAFT_KEY);
        toast.success(scheduleOn ? `${pluralize(withEmail.length, 'email')} scheduled` : `Sending ${pluralize(withEmail.length, 'email')}`, { description: 'Emails are sent in the background. Track progress on the campaign page.' });
        navigate(`/app/campaigns/${r.campaign.id}`);
      },
    },
  );
  const test = useAction(() => api.post<{ to: string }>('/api/compose/test', { integrationId, to: testTo, subject, body, prospectId: current?.id ?? null }), {
    success: (r) => `Test email sent to ${r.to}`,
    onSuccess: () => setTestOpen(false),
  });
  const saveTemplate = useAction(() => api.post('/api/templates', { name: tplName, subject, body, kind: 'initial', defaultDelayDays: 3 }), {
    success: 'Saved as template',
    invalidate: [['templates']],
    onSuccess: () => setSaveTplOpen(false),
  });

  const canSend = withEmail.length > 0 && integration && subject.trim() && body.trim() && followUps.every((f) => f.subject.trim() && f.body.trim());
  const followTemplates = templates.data?.templates.filter((t) => t.kind === 'follow_up') ?? [];
  const name = (r: ProspectListItem) => r.name ?? live.get(r.placeId)?.name ?? 'Business on Google Maps';

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Compose"
        description="Personalized emails sent from your connected mailbox, one message per recipient."
        breadcrumbs={[{ label: 'Prospects', to: '/app/prospects' }, { label: 'Compose' }]}
        actions={
          <>
            <Menu>
              <MenuTrigger asChild>
                <Button leftIcon={<FileText />}>Use template</Button>
              </MenuTrigger>
              <MenuContent className="w-[280px]">
                <MenuLabel>Templates</MenuLabel>
                {templates.data?.templates.filter((t) => t.kind === 'initial').map((t) => (
                  <MenuItem key={t.id} onSelect={() => { setSubject(t.subject); setBody(t.body); }}>
                    {t.name}
                  </MenuItem>
                ))}
                {!templates.data?.templates.length && <div className="px-2 py-1.5 text-[12.5px] text-muted">No templates yet.</div>}
              </MenuContent>
            </Menu>
            <Button leftIcon={<Save />} onClick={() => { setTplName(subject.slice(0, 60) || 'New template'); setSaveTplOpen(true); }} disabled={!subject.trim() || !body.trim()}>
              Save template
            </Button>
          </>
        }
      />
      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        <div className="min-h-0 overflow-y-auto border-r border-line px-5 py-5 md:px-8">
          <div className="space-y-5">
            <Field label="Recipients">
              {prospectIds.length === 0 ? (
                <EmptyState compact icon={<Users />} title="No recipients selected" description="Select prospects on the Prospects page, then choose Compose." action={<Button variant="primary" asChild><Link to="/app/prospects">Choose prospects</Link></Button>} className="rounded-lg border border-dashed border-line" />
              ) : (
                <div className="rounded-lg border border-line bg-panel">
                  <div className="flex items-center justify-between border-b border-line px-3.5 py-2 text-[12.5px]">
                    <span className="font-medium">{pluralize(recipientRows.length || prospectIds.length, 'recipient')}</span>
                    {skipped > 0 && <span className="text-warning">{skipped} without an email address or unsubscribed will be skipped</span>}
                  </div>
                  <ul className="max-h-[168px] divide-y divide-line overflow-y-auto">
                    {recipientRows.map((r, i) => (
                      <li key={r.id} className={cn('flex items-center gap-2 px-3.5 py-2 text-[13px]', i === previewIndex && 'bg-wash/60')}>
                        <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setPreviewIndex(i)}>
                          {name(r)}
                        </button>
                        {r.email && !r.unsubscribed ? <span className="truncate text-[12px] text-muted">{r.email}</span> : <Badge tone="warning">{r.unsubscribed ? 'Unsubscribed' : 'No email'}</Badge>}
                        <Button size="icon-sm" variant="ghost" aria-label={`Remove ${name(r)}`} onClick={() => setProspectIds((ids) => ids.filter((x) => x !== r.id))}>
                          <X />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Field>

            <Field label="Send from">
              {integrations.isLoading ? (
                <div className="skeleton h-9" />
              ) : activeIntegrations.length === 0 ? (
                <Notice tone="warning" action={<Button size="xs" variant="primary" asChild><Link to="/app/integrations">Connect</Link></Button>}>
                  Connect Gmail or Outlook to send email.
                </Notice>
              ) : (
                <Select value={integrationId} onChange={(e) => setIntegrationId(e.target.value)} aria-label="Sending mailbox">
                  {activeIntegrations.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.email} ({INTEGRATION_PROVIDER_LABELS[i.provider]}, {i.sentToday}/{i.dailySendLimit} today)
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[13px] font-medium text-ink-2">Message</span>
                <AiAssist subject={subject} body={body} prospectId={current?.id} onApply={(v) => { if (v.subject) setSubject(v.subject); if (v.body) setBody(v.body); }} />
              </div>
              <EmailFields subject={subject} body={body} onSubject={setSubject} onBody={setBody} />
              <div className="mt-1.5">
                <VariableWarnings texts={[subject, body, ...followUps.flatMap((f) => [f.subject, f.body])]} />
              </div>
            </div>

            <div className="rounded-lg border border-line bg-panel">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <div className="text-[13.5px] font-medium">Follow-ups</div>
                  <div className="text-[12px] text-muted">Sent automatically if there's no reply. Stops as soon as they reply.</div>
                </div>
                <Menu>
                  <MenuTrigger asChild>
                    <Button size="xs" leftIcon={<Plus />} disabled={followUps.length >= 5}>
                      Add follow-up
                    </Button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem onSelect={() => setFollowUps((f) => [...f, { id: uuid(), subject: `Re: ${subject}`, body: '', waitDays: 3 }])}>Blank follow-up</MenuItem>
                    {followTemplates.map((t) => (
                      <MenuItem key={t.id} onSelect={() => setFollowUps((f) => [...f, { id: uuid(), subject: t.subject, body: t.body, waitDays: t.defaultDelayDays }])}>
                        {t.name}
                      </MenuItem>
                    ))}
                  </MenuContent>
                </Menu>
              </div>
              {followUps.length === 0 ? (
                <p className="px-4 py-3 text-[12.5px] text-muted">No follow-ups. Most replies come after a gentle follow-up, so consider adding one.</p>
              ) : (
                <ol className="divide-y divide-line">
                  {followUps.map((f, i) => (
                    <li key={f.id} className="space-y-2 px-4 py-3">
                      <div className="flex items-center gap-2 text-[12.5px]">
                        <span className="font-medium">Follow-up {i + 1}</span>
                        <span className="text-muted">sent</span>
                        <Input type="number" min={1} max={60} value={f.waitDays} onChange={(e) => setFollowUps((list) => list.map((x) => (x.id === f.id ? { ...x, waitDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) } : x)))} className="h-7 w-16 text-center" aria-label="Days to wait" />
                        <span className="text-muted">days after the previous email</span>
                        <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Remove follow-up" onClick={() => setFollowUps((list) => list.filter((x) => x.id !== f.id))}>
                          <Trash2 />
                        </Button>
                      </div>
                      <EmailFields subject={f.subject} body={f.body} onSubject={(v) => setFollowUps((list) => list.map((x) => (x.id === f.id ? { ...x, subject: v } : x)))} onBody={(v) => setFollowUps((list) => list.map((x) => (x.id === f.id ? { ...x, body: v } : x)))} bodyRows={6} />
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3">
              <div>
                <div className="flex items-center gap-2 text-[13.5px] font-medium">
                  <CalendarClock className="size-4" /> Schedule
                </div>
                <div className="text-[12px] text-muted">Send later instead of now.</div>
              </div>
              <div className="flex items-center gap-2">
                {scheduleOn && <Input type="datetime-local" value={scheduledFor} min={toLocalInputValue(new Date())} onChange={(e) => setScheduledFor(e.target.value)} className="h-8 w-[210px]" aria-label="Send at" />}
                <Switch checked={scheduleOn} onCheckedChange={setScheduleOn} label="Schedule" />
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto bg-wash/40 px-5 py-5 md:px-8">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-2">Preview {current ? `for ${name(current)}` : ''}</span>
            {recipientRows.length > 1 && (
              <div className="flex items-center gap-1">
                <Button size="icon-sm" variant="ghost" aria-label="Previous recipient" disabled={previewIndex === 0} onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}>
                  <ChevronLeft />
                </Button>
                <span className="tabular text-[12px] text-muted">
                  {previewIndex + 1} / {recipientRows.length}
                </span>
                <Button size="icon-sm" variant="ghost" aria-label="Next recipient" disabled={previewIndex >= recipientRows.length - 1} onClick={() => setPreviewIndex((i) => Math.min(recipientRows.length - 1, i + 1))}>
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>
          {preview?.liveError && (
            <Notice tone="warning" className="mb-3">
              {preview.liveError} Values from Google Maps may be missing in this preview.
            </Notice>
          )}
          <EmailPreview
            subject={preview?.subject ?? subject}
            body={preview?.body ?? body}
            from={integration ? `${me.workspace.settings.defaultSenderName || me.user.name} <${integration.email}>` : null}
            to={current?.email ?? null}
            missing={preview?.missing}
            loading={previewLoading}
          />
          <p className="mt-3 text-[12px] leading-relaxed text-muted">Each recipient receives their own individual email. Variables are resolved again at send time, so edits to prospect details are always used.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-panel px-5 py-3 md:px-8">
        {!canSend && prospectIds.length > 0 && (
          <span className="mr-auto flex items-center gap-1.5 text-[12.5px] text-muted">
            <AlertTriangle className="size-3.5" />
            {!integration ? 'Connect a mailbox to send.' : withEmail.length === 0 ? 'None of the recipients have an email address.' : 'Add a subject and message.'}
          </span>
        )}
        <Button leftIcon={<MailCheck />} disabled={!integration || !subject.trim() || !body.trim()} onClick={() => setTestOpen(true)}>
          Send test
        </Button>
        <Button variant="primary" leftIcon={scheduleOn ? <CalendarClock /> : <Send />} disabled={!canSend} onClick={() => setConfirmOpen(true)}>
          {scheduleOn ? 'Schedule' : 'Send'} {withEmail.length > 0 && pluralize(withEmail.length, 'email')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={scheduleOn ? `You are about to schedule ${pluralize(withEmail.length, 'email')}.` : `You are about to send ${pluralize(withEmail.length, 'email')}.`}
        description={`From ${integration?.email ?? ''}${scheduleOn ? ` on ${new Date(scheduledFor).toLocaleString()}` : ''}. ${followUps.length ? `${pluralize(followUps.length, 'follow-up')} will be sent to anyone who doesn't reply.` : ''} ${skipped ? `${skipped} ${skipped === 1 ? 'recipient' : 'recipients'} without an email will be skipped.` : ''}`}
        confirmLabel={scheduleOn ? 'Schedule emails' : 'Send emails'}
        loading={send.isPending}
        onConfirm={() => send.mutate(undefined)}
      />
      <Dialog
        open={testOpen}
        onOpenChange={setTestOpen}
        title="Send a test email"
        description={current ? `Uses ${name(current)}'s details for personalization. Tests don't count toward your plan.` : 'Tests do not count toward your plan.'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setTestOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={test.isPending} onClick={() => test.mutate(undefined)} disabled={!testTo}>
              Send test
            </Button>
          </>
        }
      >
        <Field label="Send to" htmlFor="test-to">
          <Input id="test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        </Field>
      </Dialog>
      <Dialog
        open={saveTplOpen}
        onOpenChange={setSaveTplOpen}
        title="Save as template"
        size="sm"
        footer={
          <>
            <Button onClick={() => setSaveTplOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saveTemplate.isPending} disabled={!tplName.trim()} onClick={() => saveTemplate.mutate(undefined)}>
              Save template
            </Button>
          </>
        }
      >
        <Field label="Template name" htmlFor="tpl-name">
          <Input id="tpl-name" value={tplName} onChange={(e) => setTplName(e.target.value)} autoFocus />
        </Field>
      </Dialog>
    </div>
  );
}

