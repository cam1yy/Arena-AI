import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle2, Mail, MoreHorizontal, RefreshCw, ShieldCheck, Star, Unplug, AlertTriangle, FlaskConical } from 'lucide-react';
import { INTEGRATION_PROVIDER_LABELS, type IntegrationItem } from '@localy/shared';
import { api, errorMessage } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useMe, useSession } from '@/lib/session';
import { timeAgo } from '@/lib/utils';
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Notice, Progress, SkeletonRows } from '@/components/ui';
import { PageBody, PageHeader } from '@/components/app/page';

const SCOPE_LABELS: Record<string, string> = {
  'https://www.googleapis.com/auth/gmail.send': 'Send email as you',
  'https://www.googleapis.com/auth/gmail.readonly': 'Read messages to detect replies and bounces',
  'Mail.Send': 'Send email as you',
  'Mail.Read': 'Read messages to detect replies and bounces',
  offline_access: 'Stay connected without signing in again',
  'User.Read': 'Read your basic profile',
  'sandbox.send': 'Record sends locally (never delivered)',
  'sandbox.read': 'Accept simulated replies',
};

export default function Integrations() {
  const me = useMe();
  const { config } = useSession();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useApi<{ integrations: IntegrationItem[] }>(['integrations'], '/api/integrations');
  const [disconnecting, setDisconnecting] = useState<IntegrationItem | null>(null);
  const [limitFor, setLimitFor] = useState<IntegrationItem | null>(null);
  const [limit, setLimit] = useState(200);

  useEffect(() => {
    const connected = params.get('connected');
    const err = params.get('error');
    if (connected) toast.success(`Connected ${connected}`);
    if (err) toast.error(err);
    if (connected || err) setParams({}, { replace: true });
  }, [params, setParams]);

  const connect = async (provider: 'gmail' | 'microsoft' | 'sandbox', opts: { email?: string; reconnect?: boolean } = {}) => {
    try {
      const r = await api.post<{ url: string | null }>(`/api/integrations/${provider}/connect`, { redirect: '/app/integrations', ...opts });
      if (r.url) window.location.href = r.url;
      else {
        toast.success('Development sandbox mailbox connected');
        void refetch();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const inv = [['integrations']] as unknown[][];
  const disconnect = useAction((id: string) => api.delete(`/api/integrations/${id}`), { success: 'Mailbox disconnected. Campaigns using it were paused.', invalidate: [...inv, ['campaigns']], onSuccess: () => setDisconnecting(null) });
  const test = useAction((id: string) => api.post<{ ok: boolean; message?: string }>(`/api/integrations/${id}/test`), {
    invalidate: inv,
    onSuccess: (r) => (r.ok ? toast.success('Connection is healthy') : toast.error(r.message ?? 'Connection check failed')),
  });
  const sync = useAction((id: string) => api.post<{ processed: number }>(`/api/integrations/${id}/sync`), { success: (r) => (r.processed ? `${r.processed} new ${r.processed === 1 ? 'reply' : 'replies'} found` : 'No new replies'), invalidate: [...inv, ['inbox']] });
  const update = useAction((v: { id: string; dailySendLimit?: number; isDefault?: boolean }) => api.patch(`/api/integrations/${v.id}`, v), { success: 'Mailbox updated', invalidate: inv, onSuccess: () => setLimitFor(null) });

  const list = data?.integrations ?? [];
  const providers = [
    { id: 'gmail' as const, name: 'Gmail', sub: 'Gmail and Google Workspace', enabled: config?.features.gmail, env: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET' },
    { id: 'microsoft' as const, name: 'Microsoft Outlook', sub: 'Outlook.com and Microsoft 365', enabled: config?.features.microsoft, env: 'MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET' },
  ];

  return (
    <>
      <PageHeader title="Integrations" description="Connect the mailboxes Localy sends from. Connections use OAuth: Localy never sees your password, and tokens are encrypted at rest." />
      <PageBody width="narrow" className="space-y-8">
        {!me.user.emailVerified && <Notice tone="warning">Confirm your email address before connecting a mailbox.</Notice>}

        <section>
          <h2 className="mb-3 text-[14px] font-semibold">Connected mailboxes</h2>
          {isLoading ? (
            <div className="rounded-lg border border-line bg-panel"><SkeletonRows rows={2} /></div>
          ) : error ? (
            <EmptyState compact title="Integrations could not be loaded" description={error.message} action={<Button onClick={() => refetch()}>Try again</Button>} />
          ) : list.length === 0 ? (
            <EmptyState compact icon={<Mail />} title="No mailboxes connected" description="Connect Gmail or Outlook to send outreach from your own address." className="rounded-lg border border-dashed border-line" />
          ) : (
            <div className="space-y-3">
              {list.map((i) => (
                <Card key={i.id} className="p-5">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-canvas">
                      {i.provider === 'sandbox' ? <FlaskConical className="size-4" /> : <Mail className="size-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold">{i.email}</span>
                        {i.status === 'active' ? <Badge tone="positive" dot>Connected</Badge> : <Badge tone="danger">Needs reconnection</Badge>}
                        {i.isDefault && <Badge tone="outline">Default</Badge>}
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-muted">
                        {INTEGRATION_PROVIDER_LABELS[i.provider]}
                        {i.connectedBy && ` \u00b7 connected by ${i.connectedBy.name}`} &middot; {timeAgo(i.createdAt)}
                        {i.lastSyncedAt && ` \u00b7 checked for replies ${timeAgo(i.lastSyncedAt)}`}
                      </div>
                      {i.lastError && (
                        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-danger">
                          <AlertTriangle className="size-3.5" /> {i.lastError}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {i.status !== 'active' && i.provider !== 'sandbox' && (
                        <Button size="sm" variant="primary" leftIcon={<RefreshCw />} onClick={() => connect(i.provider as 'gmail' | 'microsoft', { email: i.email, reconnect: true })}>
                          Reauthorize
                        </Button>
                      )}
                      <Menu>
                        <MenuTrigger asChild>
                          <Button size="icon" aria-label="Mailbox actions">
                            <MoreHorizontal />
                          </Button>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuItem icon={<ShieldCheck />} onSelect={() => test.mutate(i.id)}>Test connection</MenuItem>
                          {i.provider !== 'sandbox' && <MenuItem icon={<RefreshCw />} onSelect={() => sync.mutate(i.id)}>Check for replies now</MenuItem>}
                          {i.provider !== 'sandbox' && <MenuItem icon={<RefreshCw />} onSelect={() => connect(i.provider as 'gmail' | 'microsoft', { email: i.email, reconnect: true })}>Reauthorize</MenuItem>}
                          {!i.isDefault && <MenuItem icon={<Star />} onSelect={() => update.mutate({ id: i.id, isDefault: true })}>Make default</MenuItem>}
                          <MenuItem icon={<Mail />} onSelect={() => { setLimit(i.dailySendLimit); setLimitFor(i); }}>Daily sending limit</MenuItem>
                          <MenuSeparator />
                          <MenuItem icon={<Unplug />} destructive onSelect={() => setDisconnecting(i)}>Disconnect</MenuItem>
                        </MenuContent>
                      </Menu>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between text-[12px] text-muted">
                        <span>Sent today</span>
                        <span className="tabular">{i.sentToday} / {i.dailySendLimit}</span>
                      </div>
                      <Progress value={(i.sentToday / Math.max(1, i.dailySendLimit)) * 100} className="mt-1.5" tone={i.sentToday >= i.dailySendLimit ? 'warning' : 'default'} />
                    </div>
                    <div>
                      <div className="text-[12px] text-muted">Permissions</div>
                      <ul className="mt-1 space-y-0.5 text-[12.5px]">
                        {i.scopes.filter((s) => SCOPE_LABELS[s]).map((s) => (
                          <li key={s} className="flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-positive" /> {SCOPE_LABELS[s]}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-[14px] font-semibold">Add a mailbox</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {providers.map((p) => (
              <Card key={p.id} className="flex flex-col p-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg border border-line bg-canvas"><Mail className="size-4" /></div>
                  <div>
                    <div className="text-[14px] font-semibold">{p.name}</div>
                    <div className="text-[12.5px] text-muted">{p.sub}</div>
                  </div>
                </div>
                <p className="mt-3 flex-1 text-[12.5px] leading-relaxed text-muted">{p.enabled ? 'Sends through the official API and checks your inbox for replies every few minutes.' : `Not configured on this server. Set ${p.env}.`}</p>
                <Button className="mt-4" variant={p.enabled ? 'primary' : 'secondary'} disabled={!p.enabled || !me.user.emailVerified} onClick={() => connect(p.id)}>
                  Connect {p.name.split(' ')[0]}
                </Button>
              </Card>
            ))}
          </div>
          {config?.features.devSandbox && (
            <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-dashed border-line-strong bg-panel p-4">
              <div>
                <div className="text-[13.5px] font-medium">Development sandbox mailbox</div>
                <div className="text-[12.5px] text-muted">Records every send exactly like a real mailbox but never delivers anything. Unavailable in production.</div>
              </div>
              <Button onClick={() => connect('sandbox')} leftIcon={<FlaskConical />}>Connect sandbox</Button>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-line bg-panel p-5 text-[12.5px] leading-relaxed text-muted">
          <h2 className="mb-2 text-[13.5px] font-semibold text-ink">How email integrations work</h2>
          <ul className="list-disc space-y-1 pl-4">
            <li>Localy uses OAuth 2.0 with the minimum permissions needed to send email and detect replies. You can revoke access at any time from your Google or Microsoft account.</li>
            <li>Access and refresh tokens are encrypted with AES-256-GCM before being stored. Passwords are never requested or stored.</li>
            <li>Localy only reads messages to match replies and bounces to your outreach. Unrelated emails are ignored and not stored.</li>
            <li>Daily limits protect your sender reputation. Every outreach email includes an unsubscribe link, and opt-outs apply across your workspace.</li>
          </ul>
        </section>
      </PageBody>
      <ConfirmDialog
        open={Boolean(disconnecting)}
        onOpenChange={(o) => !o && setDisconnecting(null)}
        title={`Disconnect ${disconnecting?.email}?`}
        description="Tokens are deleted and access is revoked. Active campaigns sending from this mailbox are paused, and queued emails are cancelled."
        confirmLabel="Disconnect"
        destructive
        loading={disconnect.isPending}
        onConfirm={() => disconnecting && disconnect.mutate(disconnecting.id)}
      />
      <Dialog open={Boolean(limitFor)} onOpenChange={(o) => !o && setLimitFor(null)} title="Daily sending limit" description={`Maximum emails per day from ${limitFor?.email}, across all campaigns.`} size="sm" footer={<><Button onClick={() => setLimitFor(null)}>Cancel</Button><Button variant="primary" loading={update.isPending} onClick={() => limitFor && update.mutate({ id: limitFor.id, dailySendLimit: limit })}>Save</Button></>}>
        <Field label="Emails per day" hint="Gmail allows up to 500 per day for personal accounts and 2,000 for Workspace. We recommend staying well below that for cold outreach.">
          <Input type="number" min={1} max={2000} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))} />
        </Field>
      </Dialog>
    </>
  );
}
