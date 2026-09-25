import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowDown, ArrowUp, Clock, FileText, Plus, Trash2 } from 'lucide-react';
import { INTEGRATION_PROVIDER_LABELS, type CampaignItem, type IntegrationItem, type TemplateItem } from '@localy/shared';
import { api, ApiError } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useMe } from '@/lib/session';
import { cn, uuid } from '@/lib/utils';
import { Button, Card, CardHeader, Field, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Notice, Select, Skeleton, Switch } from '@/components/ui';
import { PageBody, PageHeader } from '@/components/app/page';
import { EmailFields, VariableWarnings } from '@/components/email/editor';

interface StepDraft {
  key: string;
  id?: string;
  templateId: string | null;
  subject: string;
  body: string;
  waitDays: number;
  enabled: boolean;
}

const DAYS = [
  { v: 1, l: 'Mon' },
  { v: 2, l: 'Tue' },
  { v: 3, l: 'Wed' },
  { v: 4, l: 'Thu' },
  { v: 5, l: 'Fri' },
  { v: 6, l: 'Sat' },
  { v: 7, l: 'Sun' },
];

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

export default function CampaignEditor() {
  const { id } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editing = Boolean(id);
  const existing = useApi<{ campaign: CampaignItem }>(['campaign', id], id ? `/api/campaigns/${id}` : null);
  const integrations = useApi<{ integrations: IntegrationItem[] }>(['integrations'], '/api/integrations');
  const templates = useApi<{ templates: TemplateItem[] }>(['templates'], '/api/templates');
  const prospectIds = useMemo(() => (params.get('prospects') ?? '').split(',').filter(Boolean), [params]);

  const [name, setName] = useState('');
  const [integrationId, setIntegrationId] = useState('');
  const [senderName, setSenderName] = useState(me.workspace.settings.defaultSenderName ?? me.user.name);
  const [replyTo, setReplyTo] = useState(me.workspace.settings.defaultReplyTo ?? '');
  const [dailyLimit, setDailyLimit] = useState(40);
  const [startAt, setStartAt] = useState('');
  const [timezone, setTimezone] = useState(me.user.timezone || 'UTC');
  const [windowStart, setWindowStart] = useState(8);
  const [windowEnd, setWindowEnd] = useState(17);
  const [sendDays, setSendDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [stopOnReply, setStopOnReply] = useState(true);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    if (editing && existing.data) {
      const c = existing.data.campaign;
      setName(c.name);
      setIntegrationId(c.integration?.id ?? '');
      setSenderName(c.senderName ?? '');
      setReplyTo(c.replyTo ?? '');
      setDailyLimit(c.dailyLimit);
      setStartAt(c.startAt ? c.startAt.slice(0, 16) : '');
      setTimezone(c.timezone);
      setWindowStart(c.sendWindowStart);
      setWindowEnd(c.sendWindowEnd);
      setSendDays(c.sendDays);
      setStopOnReply(c.stopOnReply);
      setSteps(c.steps.map((s) => ({ key: s.id, id: s.id, templateId: s.templateId, subject: s.subject, body: s.body, waitDays: s.waitDays, enabled: s.enabled })));
      setLoaded(true);
    } else if (!editing && templates.data) {
      const initial = templates.data.templates.find((t) => t.kind === 'initial');
      const follows = templates.data.templates.filter((t) => t.kind === 'follow_up').slice(0, 2);
      const s: StepDraft[] = [];
      if (initial) s.push({ key: uuid(), templateId: initial.id, subject: initial.subject, body: initial.body, waitDays: 0, enabled: true });
      else s.push({ key: uuid(), templateId: null, subject: '', body: '', waitDays: 0, enabled: true });
      for (const f of follows) s.push({ key: uuid(), templateId: f.id, subject: f.subject, body: f.body, waitDays: f.defaultDelayDays, enabled: true });
      setSteps(s);
      setName(`${me.workspace.settings.businessLocation ? `${me.workspace.settings.businessLocation} ` : ''}outreach`);
      setLoaded(true);
    }
  }, [editing, existing.data, templates.data, loaded, me.workspace.settings.businessLocation]);

  useEffect(() => {
    const list = integrations.data?.integrations.filter((i) => i.status === 'active') ?? [];
    if (!editing && !integrationId && list.length) {
      const d = list.find((i) => i.isDefault) ?? list[0];
      setIntegrationId(d.id);
      setDailyLimit(Math.min(40, d.dailySendLimit));
    }
  }, [integrations.data, integrationId, editing]);

  const save = useAction(
    () => {
      const body = {
        name,
        integrationId: integrationId || null,
        senderName: senderName || null,
        replyTo: replyTo || null,
        dailyLimit,
        startAt: startAt ? new Date(startAt).toISOString() : null,
        timezone,
        sendWindowStart: windowStart,
        sendWindowEnd: windowEnd,
        sendDays,
        stopOnReply,
        steps: steps.map((s) => ({ id: s.id, templateId: s.templateId, subject: s.subject, body: s.body, waitDays: s.waitDays, enabled: s.enabled })),
        prospectIds: editing ? undefined : prospectIds,
      };
      return editing ? api.put<{ campaign: CampaignItem }>(`/api/campaigns/${id}`, body) : api.post<{ campaign: CampaignItem }>('/api/campaigns', body);
    },
    {
      success: editing ? 'Campaign saved' : 'Campaign created',
      invalidate: [['campaigns'], ['campaign', id]],
      onSuccess: (r) => navigate(`/app/campaigns/${r.campaign.id}`),
      onError: (e: ApiError) => setErrors(e.fields),
    },
  );

  const updateStep = (key: string, patch: Partial<StepDraft>) => setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) =>
    setSteps((list) => {
      const n = [...list];
      const j = i + dir;
      if (j < 1 || j >= n.length || i < 1) return list;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const totalDays = steps.slice(1).filter((s) => s.enabled).reduce((a, s) => a + s.waitDays, 0);
  const activeIntegrations = integrations.data?.integrations.filter((i) => i.status === 'active') ?? [];
  const selectedIntegration = activeIntegrations.find((i) => i.id === integrationId);
  const invalid = !name.trim() || !steps.length || steps.some((s) => !s.subject.trim() || !s.body.trim()) || windowEnd <= windowStart || !sendDays.length;

  if ((editing && existing.isLoading) || !loaded) {
    return (
      <PageBody width="narrow">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-6 h-40" />
        <Skeleton className="mt-4 h-72" />
      </PageBody>
    );
  }
  if (editing && existing.data && ['active', 'completed'].includes(existing.data.campaign.status)) {
    return (
      <PageBody width="narrow">
        <Notice tone="warning" title={existing.data.campaign.status === 'active' ? 'Pause the campaign to edit it' : 'Completed campaigns cannot be edited'} action={<Button asChild><Link to={`/app/campaigns/${id}`}>Back to campaign</Link></Button>}>
          {existing.data.campaign.status === 'active' ? 'Editing an active campaign could change emails that are about to send.' : 'Duplicate the campaign to reuse its settings.'}
        </Notice>
      </PageBody>
    );
  }

  return (
    <>
      <PageHeader
        title={editing ? 'Edit campaign' : 'Create campaign'}
        breadcrumbs={[{ label: 'Campaigns', to: '/app/campaigns' }, { label: editing ? name || 'Campaign' : 'New' }]}
        actions={
          <>
            <Button onClick={() => navigate(editing ? `/app/campaigns/${id}` : '/app/campaigns')}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} disabled={invalid} onClick={() => save.mutate(undefined)}>
              {editing ? 'Save campaign' : 'Create campaign'}
            </Button>
          </>
        }
      />
      <PageBody width="narrow" className="space-y-6">
        {!editing && prospectIds.length > 0 && <Notice tone="info">{prospectIds.length} selected prospects will be added as recipients.</Notice>}
        <p className="text-[13px] text-muted">Campaigns are saved as drafts. Nothing is sent until you review recipients and start the campaign.</p>

        <Card>
          <CardHeader title="Details" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Campaign name" htmlFor="c-name" className="sm:col-span-2" error={errors.name}>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cape Town web outreach" />
            </Field>
            <Field label="Send from" htmlFor="c-int" hint={selectedIntegration ? `${selectedIntegration.sentToday} of ${selectedIntegration.dailySendLimit} sent from this mailbox today` : undefined}>
              {activeIntegrations.length ? (
                <Select id="c-int" value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
                  <option value="">Choose a mailbox</option>
                  {activeIntegrations.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.email} ({INTEGRATION_PROVIDER_LABELS[i.provider]})
                    </option>
                  ))}
                </Select>
              ) : (
                <Notice tone="warning" action={<Button size="xs" asChild><Link to="/app/integrations">Connect</Link></Button>}>
                  No mailbox connected.
                </Notice>
              )}
            </Field>
            <Field label="Sender name" htmlFor="c-sender" hint="Shown as the From name and used for {{senderName}}.">
              <Input id="c-sender" value={senderName} onChange={(e) => setSenderName(e.target.value)} />
            </Field>
            <Field label="Reply-to" htmlFor="c-reply" optional error={errors.replyTo} hint="Replies go to the sending mailbox if empty.">
              <Input id="c-reply" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
            </Field>
            <Field label="Daily sending limit" htmlFor="c-limit" hint="Emails per day from this campaign. Start low to protect your sender reputation.">
              <Input id="c-limit" type="number" min={1} max={2000} value={dailyLimit} onChange={(e) => setDailyLimit(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Sequence" description={`${steps.filter((s) => s.enabled).length} ${steps.filter((s) => s.enabled).length === 1 ? 'email' : 'emails'} over ${totalDays} ${totalDays === 1 ? 'day' : 'days'}`} />
          <div className="space-y-4 p-5">
            {steps.map((s, i) => (
              <div key={s.key} className={cn('rounded-lg border border-line', !s.enabled && 'opacity-60')}>
                <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/60 px-4 py-2.5">
                  <span className="text-[13px] font-semibold">{i === 0 ? 'Email 1' : `Email ${i + 1}`}</span>
                  {i === 0 ? (
                    <span className="text-[12.5px] text-muted">Day 0, when the campaign starts</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
                      <Clock className="size-3.5" /> Wait
                      <Input type="number" min={1} max={60} value={s.waitDays} onChange={(e) => updateStep(s.key, { waitDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} className="h-7 w-14 text-center" aria-label={`Days to wait before email ${i + 1}`} />
                      days if no reply
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Menu>
                      <MenuTrigger asChild>
                        <Button size="xs" variant="ghost" leftIcon={<FileText />}>
                          Template
                        </Button>
                      </MenuTrigger>
                      <MenuContent className="w-[260px]">
                        <MenuLabel>{i === 0 ? 'First emails' : 'Follow-ups'}</MenuLabel>
                        {templates.data?.templates
                          .filter((t) => (i === 0 ? t.kind === 'initial' : true))
                          .map((t) => (
                            <MenuItem key={t.id} onSelect={() => updateStep(s.key, { templateId: t.id, subject: t.subject, body: t.body, ...(i > 0 ? { waitDays: t.defaultDelayDays } : {}) })}>
                              {t.name}
                            </MenuItem>
                          ))}
                      </MenuContent>
                    </Menu>
                    {i > 0 && (
                      <>
                        <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i <= 1} onClick={() => move(i, -1)}>
                          <ArrowUp />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i >= steps.length - 1} onClick={() => move(i, 1)}>
                          <ArrowDown />
                        </Button>
                        <Switch checked={s.enabled} onCheckedChange={(v) => updateStep(s.key, { enabled: v })} label={`Enable email ${i + 1}`} />
                        {!s.id && (
                          <Button size="icon-sm" variant="ghost" aria-label="Remove step" onClick={() => setSteps((l) => l.filter((x) => x.key !== s.key))}>
                            <Trash2 />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="p-3">
                  <EmailFields subject={s.subject} body={s.body} onSubject={(v) => updateStep(s.key, { subject: v, templateId: s.templateId })} onBody={(v) => updateStep(s.key, { body: v })} bodyRows={i === 0 ? 11 : 6} className="shadow-none" />
                </div>
              </div>
            ))}
            <VariableWarnings texts={steps.flatMap((s) => [s.subject, s.body])} />
            <Button leftIcon={<Plus />} disabled={steps.length >= 8} onClick={() => setSteps((l) => [...l, { key: uuid(), templateId: null, subject: `Re: ${l[0]?.subject ?? ''}`, body: '', waitDays: 3, enabled: true }])}>
              Add follow-up
            </Button>
            <label className="flex items-start justify-between gap-4 rounded-lg border border-line p-4">
              <span>
                <span className="block text-[13.5px] font-medium">Stop the sequence when someone replies</span>
                <span className="block text-[12.5px] text-muted">Recommended. Localy checks your inbox for replies and stops remaining follow-ups for that prospect.</span>
              </span>
              <Switch checked={stopOnReply} onCheckedChange={setStopOnReply} label="Stop on reply" />
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader title="Schedule" description="Emails only go out inside this window, in the recipient-facing timezone you choose." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Start date" htmlFor="c-start" optional hint="Leave empty to start when you press Start.">
              <Input id="c-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </Field>
            <Field label="Timezone" htmlFor="c-tz">
              <Select id="c-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sending window" error={windowEnd <= windowStart ? 'The window must end after it starts.' : undefined}>
              <div className="flex items-center gap-2">
                <Select value={windowStart} onChange={(e) => setWindowStart(Number(e.target.value))} aria-label="Window start">
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </Select>
                <span className="text-muted">to</span>
                <Select value={windowEnd} onChange={(e) => setWindowEnd(Number(e.target.value))} aria-label="Window end">
                  {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                    <option key={h} value={h}>
                      {h === 24 ? '24:00' : `${String(h).padStart(2, '0')}:00`}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
            <Field label="Sending days">
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d) => (
                  <button
                    key={d.v}
                    type="button"
                    aria-pressed={sendDays.includes(d.v)}
                    onClick={() => setSendDays((s) => (s.includes(d.v) ? s.filter((x) => x !== d.v) : [...s, d.v].sort()))}
                    className={cn('h-8 w-11 rounded-md border text-[12.5px] font-medium transition-colors', sendDays.includes(d.v) ? 'border-ink bg-ink text-white' : 'border-line bg-panel text-ink-2 hover:border-line-strong')}
                  >
                    {d.l}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Card>
      </PageBody>
    </>
  );
}
