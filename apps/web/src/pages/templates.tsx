import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Copy, FileText, MoreHorizontal, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { EXAMPLE_VARIABLES, renderEmail, TEMPLATE_VARIABLES, type TemplateItem } from '@localy/shared';
import { api, ApiError } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useMe, useSession } from '@/lib/session';
import { cn, timeAgo } from '@/lib/utils';
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, SegmentedControl, Select, SkeletonRows } from '@/components/ui';
import { PageBody, PageHeader } from '@/components/app/page';
import { EmailFields, EmailPreview, VariableWarnings } from '@/components/email/editor';

type Draft = { id?: string; name: string; subject: string; body: string; kind: 'initial' | 'follow_up'; defaultDelayDays: number };

export function AiAssist({ subject, body, onApply, prospectId }: { subject: string; body: string; onApply: (v: { subject?: string; body?: string }) => void; prospectId?: string | null }) {
  const { config } = useSession();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ subject?: string; body?: string; suggestions?: string[]; text?: string } | null>(null);
  const [tone, setTone] = useState<'friendly' | 'professional' | 'concise'>('friendly');
  const run = useAction((task: 'draft' | 'rewrite' | 'subjects') => api.post<{ subject?: string; body?: string; suggestions?: string[]; text: string }>('/api/ai', { task, subject, body, tone, prospectId: prospectId ?? null }), {
    onSuccess: (r) => setResult(r),
  });
  if (!config?.features.ai) return null;
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button size="sm" leftIcon={<Sparkles />}>
            AI assist
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<Wand2 />} onSelect={() => { setOpen(true); setResult(null); run.mutate('rewrite'); }}>
            Rewrite this email
          </MenuItem>
          <MenuItem icon={<Sparkles />} onSelect={() => { setOpen(true); setResult(null); run.mutate('subjects'); }}>
            Suggest subject lines
          </MenuItem>
          <MenuItem icon={<FileText />} onSelect={() => { setOpen(true); setResult(null); run.mutate('draft'); }}>
            Draft a new email
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="AI suggestion"
        description="Review and edit before using. Nothing is sent automatically."
        size="lg"
        footer={
          result && !result.suggestions ? (
            <>
              <Button onClick={() => setOpen(false)}>Discard</Button>
              <Button variant="primary" onClick={() => { onApply({ subject: result.subject, body: result.body }); setOpen(false); }}>
                Use this version
              </Button>
            </>
          ) : undefined
        }
      >
        <div className="mb-3 flex items-center justify-between">
          <SegmentedControl size="sm" value={tone} onChange={setTone} options={[{ value: 'friendly', label: 'Friendly' }, { value: 'professional', label: 'Professional' }, { value: 'concise', label: 'Concise' }]} />
        </div>
        {run.isPending ? (
          <div className="space-y-2">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-5/6" />
          </div>
        ) : run.error ? (
          <p className="text-[13px] text-danger">{run.error.message}</p>
        ) : result?.suggestions ? (
          <ul className="space-y-1.5">
            {result.suggestions.map((s) => (
              <li key={s}>
                <button type="button" className="w-full rounded-md border border-line px-3 py-2 text-left text-[13.5px] hover:bg-hover" onClick={() => { onApply({ subject: s }); setOpen(false); }}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        ) : result ? (
          <EmailPreview subject={result.subject ?? ''} body={result.body ?? result.text ?? ''} />
        ) : null}
      </Dialog>
    </>
  );
}

function TemplateEditor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const me = useMe();
  const [d, setD] = useState<Draft>(draft);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const save = useAction((x: Draft) => (x.id ? api.put(`/api/templates/${x.id}`, x) : api.post('/api/templates', x)), {
    success: d.id ? 'Template saved' : 'Template created',
    invalidate: [['templates']],
    onSuccess: onClose,
    onError: (e: ApiError) => setErrors(e.fields),
  });
  const vars = { ...EXAMPLE_VARIABLES, senderName: me.workspace.settings.defaultSenderName || me.user.name, agencyName: me.workspace.settings.agencyName || me.workspace.name };
  const preview = useMemo(() => renderEmail(d.subject, d.body, vars), [d.subject, d.body]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={d.id ? 'Edit template' : 'New template'}
      size="xl"
      footer={
        <>
          <span className="mr-auto hidden text-[12px] text-muted sm:block">Preview uses example values. The composer shows each prospect's real values.</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!d.name.trim() || !d.subject.trim() || !d.body.trim()} onClick={() => save.mutate(d)}>
            {d.id ? 'Save template' : 'Create template'}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Name" htmlFor="t-name" error={errors.name}>
              <Input id="t-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Website idea" autoFocus />
            </Field>
            <Field label="Type" htmlFor="t-kind">
              <Select id="t-kind" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Draft['kind'] })}>
                <option value="initial">First email</option>
                <option value="follow_up">Follow-up</option>
              </Select>
            </Field>
          </div>
          {d.kind === 'follow_up' && (
            <Field label="Default follow-up delay" htmlFor="t-delay" hint="Used when you add this template to a sequence. You can change it per campaign.">
              <div className="flex items-center gap-2">
                <Input id="t-delay" type="number" min={1} max={60} value={d.defaultDelayDays} onChange={(e) => setD({ ...d, defaultDelayDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} className="w-24" />
                <span className="text-[13px] text-muted">days after the previous email</span>
              </div>
            </Field>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-2">Message</span>
            <AiAssist subject={d.subject} body={d.body} onApply={(v) => setD((x) => ({ ...x, subject: v.subject ?? x.subject, body: v.body ?? x.body }))} />
          </div>
          <EmailFields subject={d.subject} body={d.body} onSubject={(v) => setD({ ...d, subject: v })} onBody={(v) => setD({ ...d, body: v })} bodyRows={13} />
          <VariableWarnings texts={[d.subject, d.body]} />
        </div>
        <div className="space-y-3">
          <div className="text-[13px] font-medium text-ink-2">Preview</div>
          <EmailPreview subject={preview.subject} body={preview.body} to={`${EXAMPLE_VARIABLES.firstName?.toLowerCase()}@example.com`} missing={preview.missing} footerNote="Your signature and an unsubscribe footer are added when sending (configurable in Settings, Email)." />
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 text-[11.5px] font-medium uppercase tracking-wider text-subtle">Variables</div>
            <dl className="grid grid-cols-1 gap-1.5 text-[12px] sm:grid-cols-2">
              {TEMPLATE_VARIABLES.map((v) => (
                <div key={v.key}>
                  <dt className="font-mono text-ink-2">{`{{${v.key}}}`}</dt>
                  <dd className="text-muted">{v.description}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export default function Templates() {
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useApi<{ templates: TemplateItem[] }>(['templates'], '/api/templates');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [filter, setFilter] = useState<'all' | 'initial' | 'follow_up'>('all');
  const [deleting, setDeleting] = useState<TemplateItem | null>(null);
  const dup = useAction((id: string) => api.post(`/api/templates/${id}/duplicate`), { success: 'Template duplicated', invalidate: [['templates']] });
  const del = useAction((id: string) => api.delete(`/api/templates/${id}`), { success: 'Template deleted', invalidate: [['templates']], onSuccess: () => setDeleting(null) });

  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing({ name: '', subject: '', body: '', kind: 'initial', defaultDelayDays: 3 });
      setParams({}, { replace: true });
    }
    const editId = params.get('edit');
    if (editId && data) {
      const t = data.templates.find((x) => x.id === editId);
      if (t) setEditing({ id: t.id, name: t.name, subject: t.subject, body: t.body, kind: t.kind, defaultDelayDays: t.defaultDelayDays });
      setParams({}, { replace: true });
    }
  }, [params, data, setParams]);

  const list = (data?.templates ?? []).filter((t) => filter === 'all' || t.kind === filter);
  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable emails with personalization variables."
        actions={
          <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing({ name: '', subject: '', body: '', kind: 'initial', defaultDelayDays: 3 })}>
            New template
          </Button>
        }
      />
      <PageBody>
        <div className="mb-4">
          <SegmentedControl value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'initial', label: 'First emails' }, { value: 'follow_up', label: 'Follow-ups' }]} />
        </div>
        {isLoading ? (
          <div className="rounded-lg border border-line bg-panel">
            <SkeletonRows rows={4} />
          </div>
        ) : error ? (
          <EmptyState title="Templates could not be loaded" description={error.message} action={<Button onClick={() => refetch()}>Try again</Button>} />
        ) : list.length === 0 ? (
          <EmptyState icon={<FileText />} title="No templates yet" description="Create a template to reuse your best outreach emails." action={<Button variant="primary" onClick={() => setEditing({ name: '', subject: '', body: '', kind: filter === 'follow_up' ? 'follow_up' : 'initial', defaultDelayDays: 3 })}>Create template</Button>} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((t) => (
              <div
                key={t.id}
                className="group flex cursor-pointer flex-col rounded-lg border border-line bg-panel p-4 shadow-xs transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-sm"
                onClick={() => setEditing({ id: t.id, name: t.name, subject: t.subject, body: t.body, kind: t.kind, defaultDelayDays: t.defaultDelayDays })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setEditing({ id: t.id, name: t.name, subject: t.subject, body: t.body, kind: t.kind, defaultDelayDays: t.defaultDelayDays })}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold">{t.name}</div>
                    <div className="mt-0.5 truncate text-[12.5px] text-muted">{t.subject}</div>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Menu>
                      <MenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label="Template actions">
                          <MoreHorizontal />
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem icon={<Copy />} onSelect={() => dup.mutate(t.id)}>
                          Duplicate
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting(t)}>
                          Delete
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </div>
                </div>
                <p className="mt-3 line-clamp-4 flex-1 whitespace-pre-line text-[12.5px] leading-relaxed text-muted">{t.body}</p>
                <div className="mt-4 flex items-center gap-2 text-[11.5px] text-subtle">
                  <Badge tone={t.kind === 'initial' ? 'neutral' : 'outline'}>{t.kind === 'initial' ? 'First email' : `Follow-up, ${t.defaultDelayDays}d`}</Badge>
                  {t.usageCount > 0 && <span>Used in {t.usageCount} {t.usageCount === 1 ? 'step' : 'steps'}</span>}
                  <span className={cn('ml-auto')}>Edited {timeAgo(t.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>
      {editing && <TemplateEditor draft={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="Campaigns that already copied this template keep their own copy of the content."
        confirmLabel="Delete template"
        destructive
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </>
  );
}
