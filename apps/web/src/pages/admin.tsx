import { useState, type FormEvent } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { SUBSCRIPTION_STATUSES, type PlanLimits } from '@localy/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useMe } from '@/lib/session';
import { cn, formatDate, formatDateTime, formatNumber, timeAgo } from '@/lib/utils';
import { Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, EmptyState, Field, Input, Notice, Select, Skeleton, Switch, Textarea } from '@/components/ui';
import { Logo } from '@/components/app/logo';
import { Metric, MetricGrid } from '@/components/app/metric';

/*
 * Internal admin console for the Localy operator. Access requires
 * users.is_platform_admin (granted only via the CLI) plus a password
 * re-confirmation that expires after 30 minutes. Workspace roles never grant
 * access. Every admin action is audit logged.
 */

function Elevate({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/admin/elevate', { password });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-5">
      <form onSubmit={submit} className="w-full max-w-[360px] space-y-4">
        <ShieldCheck className="size-6" />
        <h1 className="text-[20px] font-semibold tracking-tight">Confirm admin access</h1>
        <p className="text-[13.5px] text-muted">Enter your password to open the admin console. Access expires after 30 minutes.</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!password}>Continue</Button>
        <Link to="/app" className="block text-center text-[13px] text-muted hover:text-ink">Back to Localy</Link>
      </form>
    </div>
  );
}

function Overview() {
  const { data, isLoading } = useApi<{ users: { total: number; new7d: number }; workspaces: number; subscriptions: { planKey: string; status: string; n: number }[]; campaigns: { active: number; total: number }; integrations: { active: number; errored: number }; errors24h: number; usageThisMonth: Record<string, number> }>(['admin', 'overview'], '/api/admin/overview');
  return (
    <div className="space-y-6">
      <MetricGrid>
        <Metric label="Users" value={data?.users.total} loading={isLoading} sub={data ? `${data.users.new7d} new in 7 days` : undefined} />
        <Metric label="Workspaces" value={data?.workspaces} loading={isLoading} />
        <Metric label="Active campaigns" value={data?.campaigns.active} loading={isLoading} sub={data ? `${data.campaigns.total} total` : undefined} />
        <Metric label="Errors (24h)" value={data?.errors24h} loading={isLoading} />
        <Metric label="Mailboxes connected" value={data?.integrations.active} loading={isLoading} sub={data ? `${data.integrations.errored} need attention` : undefined} />
        <Metric label="Emails this month" value={data?.usageThisMonth.emails_sent ?? 0} loading={isLoading} />
        <Metric label="Businesses discovered" value={data?.usageThisMonth.businesses_discovered ?? 0} loading={isLoading} />
        <Metric label="Places requests" value={data?.usageThisMonth.places_requests ?? 0} loading={isLoading} />
      </MetricGrid>
      <Card>
        <CardHeader title="Subscriptions" />
        <ul className="divide-y divide-line">
          {data?.subscriptions.map((s) => (
            <li key={`${s.planKey}-${s.status}`} className="flex justify-between px-5 py-2.5 text-[13px]"><span>{s.planKey} &middot; {s.status}</span><span className="tabular font-medium">{s.n}</span></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Users() {
  const me = useMe();
  const [q, setQ] = useState('');
  const { data, isLoading } = useApi<{ items: { id: string; name: string; email: string; emailVerifiedAt: string | null; isPlatformAdmin: boolean; disabledAt: string | null; lastLoginAt: string | null; createdAt: string; twoFactor: boolean; workspaces: number }[]; total: number }>(['admin', 'users', q], `/api/admin/users?q=${encodeURIComponent(q)}`);
  const toggle = useAction((v: { id: string; disabled: boolean }) => api.post(`/api/admin/users/${v.id}/disabled`, { disabled: v.disabled }), { success: 'User updated', invalidate: [['admin', 'users']] });
  return (
    <Card>
      <CardHeader title={`Users${data ? ` (${formatNumber(data.total)})` : ''}`} action={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-8 w-[220px]" aria-label="Search users" />} />
      {isLoading ? <Skeleton className="m-5 h-32" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead><tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wider text-subtle"><th className="px-5 py-2 font-medium">User</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Workspaces</th><th className="px-3 py-2 font-medium">Last login</th><th className="px-3 py-2 font-medium">Joined</th><th className="px-5 py-2" /></tr></thead>
            <tbody className="divide-y divide-line">
              {data?.items.map((u) => (
                <tr key={u.id}>
                  <td className="px-5 py-2.5"><div className="font-medium">{u.name} {u.isPlatformAdmin && <Badge tone="solid">Admin</Badge>}</div><div className="text-[12px] text-muted">{u.email}</div></td>
                  <td className="px-3 py-2.5 space-x-1">{u.disabledAt ? <Badge tone="danger">Disabled</Badge> : <Badge tone="positive">Active</Badge>}{!u.emailVerifiedAt && <Badge tone="warning">Unverified</Badge>}{u.twoFactor && <Badge tone="outline">2FA</Badge>}</td>
                  <td className="tabular px-3 py-2.5">{u.workspaces}</td>
                  <td className="px-3 py-2.5 text-muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}</td>
                  <td className="px-3 py-2.5 text-muted">{formatDate(u.createdAt)}</td>
                  <td className="px-5 py-2.5 text-right">{u.id !== me.user.id && <Button size="xs" variant={u.disabledAt ? 'secondary' : 'ghost'} onClick={() => toggle.mutate({ id: u.id, disabled: !u.disabledAt })}>{u.disabledAt ? 'Enable' : 'Disable'}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Workspaces() {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; planKey: string | null; status: string | null; trialEndsAt: string | null; limitOverrides: Partial<PlanLimits> | null } | null>(null);
  const { data, isLoading } = useApi<{ items: { id: string; name: string; createdAt: string; planKey: string | null; status: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null; stripeSubscriptionId: string | null; limitOverrides: Partial<PlanLimits> | null; members: number; prospects: number; campaigns: number; isDevData: boolean; usage: Record<string, number> }[]; total: number }>(['admin', 'workspaces', q], `/api/admin/workspaces?q=${encodeURIComponent(q)}`);
  const [form, setForm] = useState({ planKey: '', status: '', trialEndsAt: '', overrides: '' });
  const save = useAction(() => {
    let limitOverrides: Partial<PlanLimits> | null = null;
    if (form.overrides.trim()) limitOverrides = JSON.parse(form.overrides);
    return api.patch(`/api/admin/workspaces/${editing!.id}/subscription`, { planKey: form.planKey || undefined, status: form.status || undefined, trialEndsAt: form.trialEndsAt ? new Date(form.trialEndsAt).toISOString() : null, limitOverrides });
  }, { success: 'Subscription updated', invalidate: [['admin', 'workspaces']], onSuccess: () => setEditing(null) });
  return (
    <>
      <Card>
        <CardHeader title={`Workspaces${data ? ` (${formatNumber(data.total)})` : ''}`} action={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-8 w-[220px]" aria-label="Search workspaces" />} />
        {isLoading ? <Skeleton className="m-5 h-32" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead><tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wider text-subtle"><th className="px-5 py-2 font-medium">Workspace</th><th className="px-3 py-2 font-medium">Plan</th><th className="px-3 py-2 font-medium">Members</th><th className="px-3 py-2 font-medium">Prospects</th><th className="px-3 py-2 font-medium">Emails (month)</th><th className="px-3 py-2 font-medium">Discovered (month)</th><th className="px-5 py-2" /></tr></thead>
              <tbody className="divide-y divide-line">
                {data?.items.map((w) => (
                  <tr key={w.id}>
                    <td className="px-5 py-2.5"><div className="font-medium">{w.name} {w.isDevData && <Badge tone="warning">Dev data</Badge>}</div><div className="text-[12px] text-muted">Created {formatDate(w.createdAt)}</div></td>
                    <td className="px-3 py-2.5"><div>{w.planKey}</div><div className="text-[12px] text-muted">{w.status}{w.stripeSubscriptionId ? ' (Stripe)' : ''}</div></td>
                    <td className="tabular px-3 py-2.5">{w.members}</td>
                    <td className="tabular px-3 py-2.5">{formatNumber(w.prospects)}</td>
                    <td className="tabular px-3 py-2.5">{formatNumber(w.usage.emails_sent ?? 0)}</td>
                    <td className="tabular px-3 py-2.5">{formatNumber(w.usage.businesses_discovered ?? 0)}</td>
                    <td className="px-5 py-2.5 text-right"><Button size="xs" onClick={() => { setEditing(w); setForm({ planKey: w.planKey ?? '', status: w.status ?? '', trialEndsAt: w.trialEndsAt ? w.trialEndsAt.slice(0, 16) : '', overrides: w.limitOverrides ? JSON.stringify(w.limitOverrides) : '' }); }}>Manage</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} title={`Subscription for ${editing?.name}`} description="Manual changes are for support and comps. Stripe-managed subscriptions are overwritten by the next Stripe webhook." footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan"><Select value={form.planKey} onChange={(e) => setForm({ ...form, planKey: e.target.value })}><option value="trial">trial</option><option value="pro">pro</option><option value="agency">agency</option></Select></Field>
          <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{SUBSCRIPTION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          <Field label="Trial ends" className="sm:col-span-2"><Input type="datetime-local" value={form.trialEndsAt} onChange={(e) => setForm({ ...form, trialEndsAt: e.target.value })} /></Field>
          <Field label="Limit overrides (JSON)" className="sm:col-span-2" hint='For example {"emails_sent": 5000}'><Textarea rows={3} value={form.overrides} onChange={(e) => setForm({ ...form, overrides: e.target.value })} className="font-mono text-[12px]" /></Field>
        </div>
      </Dialog>
    </>
  );
}

function Campaigns() {
  const [status, setStatus] = useState('active');
  const [pausing, setPausing] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const { data, isLoading } = useApi<{ items: { id: string; name: string; status: string; kind: string; workspaceName: string; createdAt: string; pauseReason: string | null; dailyLimit: number }[] }>(['admin', 'campaigns', status], `/api/admin/campaigns?status=${status}`);
  const pause = useAction(() => api.post(`/api/admin/campaigns/${pausing!.id}/pause`, { reason }), { success: 'Campaign paused', invalidate: [['admin', 'campaigns']], onSuccess: () => { setPausing(null); setReason(''); } });
  return (
    <Card>
      <CardHeader title="Campaigns" action={<Select size="sm" value={status} onChange={(e) => setStatus(e.target.value)} className="w-[140px]" aria-label="Status"><option value="all">All</option><option value="active">Active</option><option value="scheduled">Scheduled</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="draft">Draft</option></Select>} />
      {isLoading ? <Skeleton className="m-5 h-24" /> : !data?.items.length ? <EmptyState compact title="No campaigns" /> : (
        <ul className="divide-y divide-line">
          {data.items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
              <div className="min-w-0 flex-1"><div className="font-medium">{c.name}</div><div className="text-[12px] text-muted">{c.workspaceName} &middot; {c.status} &middot; {c.dailyLimit}/day &middot; {formatDate(c.createdAt)}{c.pauseReason && ` \u00b7 ${c.pauseReason}`}</div></div>
              {c.status === 'active' && <Button size="xs" variant="ghost" onClick={() => setPausing(c)}>Pause</Button>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={Boolean(pausing)} onOpenChange={(o) => !o && setPausing(null)} title={`Pause "${pausing?.name}"?`} description="The workspace sees the reason on the campaign page." confirmLabel="Pause campaign" destructive loading={pause.isPending} onConfirm={() => reason.trim().length >= 3 && pause.mutate(undefined)}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shown to the customer)" aria-label="Reason" />
      </ConfirmDialog>
    </Card>
  );
}

function Integrations() {
  const { data, isLoading } = useApi<{ items: { id: string; provider: string; email: string; status: string; lastError: string | null; lastSyncedAt: string | null; lastHealthCheckAt: string | null; workspaceName: string; createdAt: string }[] }>(['admin', 'integrations'], '/api/admin/integrations');
  return (
    <Card>
      <CardHeader title="Integrations" />
      {isLoading ? <Skeleton className="m-5 h-24" /> : (
        <ul className="divide-y divide-line">
          {data?.items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
              <div className="min-w-0 flex-1"><div className="font-medium">{i.email} <span className="font-normal text-muted">({i.provider})</span></div><div className="text-[12px] text-muted">{i.workspaceName} &middot; synced {i.lastSyncedAt ? timeAgo(i.lastSyncedAt) : 'never'} &middot; health {i.lastHealthCheckAt ? timeAgo(i.lastHealthCheckAt) : 'never'}{i.lastError && ` \u00b7 ${i.lastError}`}</div></div>
              <Badge tone={i.status === 'active' ? 'positive' : i.status === 'error' ? 'danger' : 'neutral'}>{i.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Health() {
  const { data, isLoading } = useApi<{ services: { service: string; operation: string; total: number; failed: number; p50: number; p95: number; lastError: string | null }[]; queues: { name: string; queued: number; active: number }[]; configuration: Record<string, boolean> }>(['admin', 'health'], '/api/admin/api-health', { refetchInterval: 15_000 });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Configuration" />
        <div className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {data && Object.entries(data.configuration).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[12.5px]"><span>{k.replace(/([A-Z])/g, ' $1')}</span><Badge tone={v ? 'positive' : 'outline'}>{v ? 'Configured' : 'Not set'}</Badge></div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="External APIs (last 24 hours)" />
        {isLoading ? <Skeleton className="m-5 h-24" /> : !data?.services.length ? <EmptyState compact title="No external calls yet" /> : (
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wider text-subtle"><th className="px-5 py-2 font-medium">Service</th><th className="px-3 py-2 text-right font-medium">Calls</th><th className="px-3 py-2 text-right font-medium">Failed</th><th className="px-3 py-2 text-right font-medium">p50</th><th className="px-3 py-2 text-right font-medium">p95</th><th className="px-5 py-2 font-medium">Last error</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.services.map((s) => (
                <tr key={s.service + s.operation}><td className="px-5 py-2">{s.service} / {s.operation}</td><td className="tabular px-3 py-2 text-right">{s.total}</td><td className={cn('tabular px-3 py-2 text-right', s.failed && 'text-danger')}>{s.failed}</td><td className="tabular px-3 py-2 text-right">{s.p50} ms</td><td className="tabular px-3 py-2 text-right">{s.p95} ms</td><td className="px-5 py-2 text-muted">{s.lastError ?? ''}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <CardHeader title="Job queues" />
        <ul className="divide-y divide-line">
          {data?.queues.map((q) => <li key={q.name} className="flex justify-between px-5 py-2.5 text-[13px]"><span className="font-mono">{q.name}</span><span className="tabular text-muted">{q.queued} queued, {q.active} active</span></li>)}
        </ul>
      </Card>
    </div>
  );
}

function Errors() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<{ message: string; stack: string | null; context: unknown } | null>(null);
  const { data, isLoading } = useApi<{ items: { id: string; source: string; route: string | null; method: string | null; code: string | null; message: string; stack: string | null; context: unknown; createdAt: string; requestId: string | null }[] }>(['admin', 'errors', page], `/api/admin/errors?page=${page}`);
  return (
    <Card>
      <CardHeader title="Error log" action={<div className="flex gap-2"><Button size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button><Button size="xs" disabled={(data?.items.length ?? 0) < 50} onClick={() => setPage((p) => p + 1)}>Older</Button></div>} />
      {isLoading ? <Skeleton className="m-5 h-24" /> : !data?.items.length ? <EmptyState compact title="No errors recorded" /> : (
        <ul className="divide-y divide-line">
          {data.items.map((e) => (
            <li key={e.id}>
              <button type="button" className="w-full px-5 py-2.5 text-left hover:bg-hover/50" onClick={() => setOpen(e)}>
                <div className="flex justify-between gap-3 text-[12.5px]"><span className="truncate font-medium">{e.message}</span><span className="shrink-0 text-subtle">{formatDateTime(e.createdAt)}</span></div>
                <div className="text-[12px] text-muted">{e.source} &middot; {e.method} {e.route}{e.code && ` \u00b7 ${e.code}`}{e.requestId && ` \u00b7 ${e.requestId}`}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)} title="Error details" size="xl">
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-wash p-3 font-mono text-[11.5px]">{open?.message}{'\n\n'}{open?.stack}{'\n\n'}{JSON.stringify(open?.context, null, 2)}</pre>
      </Dialog>
    </Card>
  );
}

function Audit() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { data, isLoading } = useApi<{ items: { id: string; action: string; actorEmail: string | null; workspaceId: string | null; targetType: string | null; targetId: string | null; ip: string | null; metadata: Record<string, unknown>; createdAt: string }[] }>(['admin', 'audit', page, action], `/api/admin/audit-logs?page=${page}${action ? `&action=${encodeURIComponent(action)}` : ''}`);
  return (
    <Card>
      <CardHeader title="Audit log" action={<div className="flex gap-2"><Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="Filter action, e.g. auth" className="h-8 w-[200px]" aria-label="Filter by action" /><Button size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button><Button size="xs" disabled={(data?.items.length ?? 0) < 50} onClick={() => setPage((p) => p + 1)}>Older</Button></div>} />
      {isLoading ? <Skeleton className="m-5 h-24" /> : (
        <ul className="divide-y divide-line">
          {data?.items.map((e) => (
            <li key={e.id} className="grid grid-cols-[1fr_auto] gap-3 px-5 py-2.5">
              <div className="min-w-0"><div className="font-mono text-[12.5px]">{e.action}</div><div className="truncate text-[12px] text-muted">{e.actorEmail ?? 'system'}{e.ip && ` \u00b7 ${e.ip}`}{e.targetType && ` \u00b7 ${e.targetType} ${e.targetId ?? ''}`} {Object.keys(e.metadata).length > 0 && JSON.stringify(e.metadata).slice(0, 120)}</div></div>
              <span className="text-[12px] text-subtle">{formatDateTime(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SystemSettings() {
  const { data, isLoading } = useApi<{ announcement: { message: string; level: 'info' | 'warning' } | null; signupsEnabled: boolean }>(['admin', 'settings'], '/api/admin/settings');
  const plans = useApi<{ plans: { key: string; name: string; description: string; limits: PlanLimits; features: string[]; stripePriceId: string | null; isActive: boolean }[] }>(['admin', 'plans'], '/api/admin/plans');
  const [msg, setMsg] = useState('');
  const [level, setLevel] = useState<'info' | 'warning'>('info');
  const [notify, setNotify] = useState(false);
  const [editingPlan, setEditingPlan] = useState<{ key: string; json: string } | null>(null);
  const save = useAction((body: Record<string, unknown>) => api.put('/api/admin/settings', body), { success: 'Settings saved', invalidate: [['admin', 'settings'], ['config']] });
  const savePlan = useAction(() => api.put(`/api/admin/plans/${editingPlan!.key}`, JSON.parse(editingPlan!.json)), { success: 'Plan saved', invalidate: [['admin', 'plans'], ['plans']], onSuccess: () => setEditingPlan(null) });
  if (isLoading || !data) return <Skeleton className="h-40" />;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Announcement banner" description="Shown to every signed-in user at the top of the app." />
        <div className="space-y-3 p-5">
          {data.announcement && <Notice tone={data.announcement.level === 'warning' ? 'warning' : 'neutral'} action={<Button size="xs" onClick={() => save.mutate({ announcement: null })}>Remove</Button>}>{data.announcement.message}</Notice>}
          <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Scheduled maintenance on Saturday from 02:00 UTC" aria-label="Announcement" />
          <div className="flex flex-wrap items-center gap-3">
            <Select size="sm" value={level} onChange={(e) => setLevel(e.target.value as 'info' | 'warning')} className="w-[120px]" aria-label="Level"><option value="info">Info</option><option value="warning">Warning</option></Select>
            <label className="flex items-center gap-2 text-[13px]"><Switch checked={notify} onCheckedChange={setNotify} label="Also send notification" /> Also add to notification centers</label>
            <Button size="sm" variant="primary" disabled={!msg.trim()} loading={save.isPending} onClick={() => save.mutate({ announcement: { message: msg.trim(), level }, notifyUsers: notify })}>Publish</Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Sign-ups" />
        <label className="flex items-center justify-between p-5 text-[13.5px]"><span>Allow new accounts</span><Switch checked={data.signupsEnabled} onCheckedChange={(v) => save.mutate({ signupsEnabled: v })} label="Allow new accounts" /></label>
      </Card>
      <Card>
        <CardHeader title="Plans" description="Limits and features. Prices come from the Stripe price IDs." />
        <ul className="divide-y divide-line">
          {plans.data?.plans.map((p) => (
            <li key={p.key} className="flex items-center gap-3 px-5 py-3 text-[13px]">
              <div className="min-w-0 flex-1"><div className="font-medium">{p.name} <span className="font-normal text-muted">({p.key})</span></div><div className="truncate text-[12px] text-muted">{p.stripePriceId ?? 'No Stripe price'} &middot; {Object.entries(p.limits).map(([k, v]) => `${k}: ${v}`).join(', ')}</div></div>
              <Button size="xs" onClick={() => setEditingPlan({ key: p.key, json: JSON.stringify({ name: p.name, description: p.description, limits: p.limits, features: p.features, stripePriceId: p.stripePriceId, isActive: p.isActive }, null, 2) })}>Edit</Button>
            </li>
          ))}
        </ul>
      </Card>
      <Dialog open={Boolean(editingPlan)} onOpenChange={(o) => !o && setEditingPlan(null)} title={`Edit plan ${editingPlan?.key}`} size="lg" footer={<><Button onClick={() => setEditingPlan(null)}>Cancel</Button><Button variant="primary" loading={savePlan.isPending} onClick={() => savePlan.mutate(undefined)}>Save plan</Button></>}>
        <Textarea rows={18} value={editingPlan?.json ?? ''} onChange={(e) => setEditingPlan((p) => (p ? { ...p, json: e.target.value } : p))} className="font-mono text-[12px]" aria-label="Plan JSON" />
      </Dialog>
    </div>
  );
}

const NAV = [
  ['', 'Overview'],
  ['users', 'Users'],
  ['workspaces', 'Workspaces'],
  ['campaigns', 'Campaigns'],
  ['integrations', 'Integrations'],
  ['health', 'API health'],
  ['errors', 'Error logs'],
  ['audit', 'Audit logs'],
  ['settings', 'System settings'],
];

export default function Admin() {
  const me = useMe();
  const qc = useQueryClient();
  const location = useLocation();
  const probe = useApi<unknown>(['admin', 'probe'], me.user.isPlatformAdmin ? '/api/admin/overview' : null, { retry: false });
  if (!me.user.isPlatformAdmin) return <EmptyState title="Page not found" action={<Button asChild><Link to="/app">Back to Localy</Link></Button>} />;
  if (probe.isLoading) return <div className="p-10"><Skeleton className="h-8 w-48" /></div>;
  if (probe.error instanceof ApiError && probe.error.code === 'ADMIN_REAUTH_REQUIRED') return <Elevate onDone={() => qc.invalidateQueries({ queryKey: ['admin'] })} />;
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-14 items-center gap-4 border-b border-line bg-panel px-5">
        <Logo />
        <Badge tone="solid">Admin</Badge>
        <Link to="/app" className="ml-auto inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> Back to app</Link>
      </header>
      <div className="mx-auto grid max-w-[1320px] gap-6 px-5 py-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Admin">
          {NAV.map(([path, label]) => (
            <NavLink key={path} to={`/admin/${path}`} end={path === ''} className={({ isActive }) => cn('shrink-0 rounded-md px-2.5 py-1.5 text-[13px] font-medium', isActive || (path === '' && location.pathname === '/admin') ? 'bg-panel text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:bg-hover hover:text-ink')}>{label}</NavLink>
          ))}
        </nav>
        <main className="min-w-0">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="users" element={<Users />} />
            <Route path="workspaces" element={<Workspaces />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="health" element={<Health />} />
            <Route path="errors" element={<Errors />} />
            <Route path="audit" element={<Audit />} />
            <Route path="settings" element={<SystemSettings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
