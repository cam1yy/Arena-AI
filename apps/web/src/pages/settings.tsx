import { useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Download, KeyRound, Laptop, LogOut, Monitor, Plus, ShieldCheck, Smartphone, Upload } from 'lucide-react';
import {
  BUSINESS_CATEGORIES,
  NOTIFICATION_PREFERENCE_KEYS,
  PASSWORD_RULES,
  RADIUS_PRESETS_KM,
  ROLE_LABELS,
  WEBSITE_FILTER_LABELS,
  WEBSITE_FILTERS,
  checkPassword,
  type NotificationPreferences,
  type Role,
  type WebsiteFilter,
} from '@localy/shared';
import { api, ApiError, download, errorMessage } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useCan, useMe, useSession } from '@/lib/session';
import { cn, formatDate, formatDateTime, timeAgo } from '@/lib/utils';
import { Avatar, Badge, Button, ConfirmDialog, Dialog, EmptyState, Field, Input, Notice, Section, Select, Skeleton, Switch, Textarea } from '@/components/ui';
import { PageHeader } from '@/components/app/page';
import { LocationSearch } from '@/components/discover/location-search';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'account', label: 'Account' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'team', label: 'Team' },
  { id: 'email', label: 'Email' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'security', label: 'Security' },
  { id: 'billing', label: 'Billing' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'api', label: 'API' },
  { id: 'audit', label: 'Audit log' },
  { id: 'data', label: 'Data and privacy' },
  { id: 'danger', label: 'Danger zone' },
];

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-4 z-10 mt-6 flex items-center justify-between gap-3 rounded-lg border border-line bg-panel px-4 py-3 shadow-md animate-slide-up">
      <span className="text-[13px] text-muted">You have unsaved changes.</span>
      <div className="flex gap-2">
        <Button size="sm" onClick={onReset}>Discard</Button>
        <Button size="sm" variant="primary" loading={saving} onClick={onSave}>Save changes</Button>
      </div>
    </div>
  );
}

function ProfileSection() {
  const me = useMe();
  const qc = useQueryClient();
  const initial = { name: me.user.name, timezone: me.user.timezone, distanceUnit: me.user.distanceUnit };
  const [form, setForm] = useState(initial);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useAction(() => api.patch('/api/me/profile', form), { success: 'Profile saved', invalidate: [['me']] });
  const avatar = useAction((dataUrl: string | null) => api.put('/api/me/avatar', { dataUrl }), { success: 'Avatar updated', invalidate: [['me']] });
  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast.error('Choose a PNG, JPEG or WebP image.');
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const size = 192;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        avatar.mutate(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(f);
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  void qc;
  return (
    <>
      <Section title="Profile" description="How you appear to teammates.">
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar name={me.user.name} src={me.user.avatarUrl} size={56} />
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <Button size="sm" leftIcon={<Upload />} loading={avatar.isPending} onClick={() => fileRef.current?.click()}>Upload avatar</Button>
              {me.user.avatarUrl && <Button size="sm" variant="ghost" onClick={() => avatar.mutate(null)}>Remove</Button>}
            </div>
          </div>
          <Field label="Name" htmlFor="p-name"><Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email" hint="Change your sign-in email in Account.">
            <Input value={me.user.email} disabled />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Timezone" htmlFor="p-tz">
              <Select id="p-tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Distance unit" htmlFor="p-unit">
              <Select id="p-unit" value={form.distanceUnit} onChange={(e) => setForm({ ...form, distanceUnit: e.target.value as 'km' | 'mi' })}>
                <option value="km">Kilometres</option>
                <option value="mi">Miles</option>
              </Select>
            </Field>
          </div>
        </div>
      </Section>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate(undefined)} onReset={() => setForm(initial)} />
    </>
  );
}

function AccountSection() {
  const me = useMe();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const change = useAction(() => api.post('/api/auth/change-email', { email, password: password || undefined }), { success: `Check ${email} for a confirmation link`, onSuccess: () => { setEmail(''); setPassword(''); } });
  const resend = useAction(() => api.post('/api/auth/resend-verification'), { success: 'Verification email sent' });
  return (
    <Section title="Account" description="Your sign-in email address.">
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-[13.5px]">
          <span className="font-medium">{me.user.email}</span>
          {me.user.emailVerified ? <Badge tone="positive">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}
          {!me.user.emailVerified && <Button size="xs" variant="ghost" loading={resend.isPending} onClick={() => resend.mutate(undefined)}>Resend verification</Button>}
        </div>
        <div className="rounded-lg border border-line p-4">
          <div className="mb-3 text-[13.5px] font-medium">Change email address</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="New email" htmlFor="a-email"><Input id="a-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            {me.user.hasPassword && <Field label="Current password" htmlFor="a-pw"><Input id="a-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
          </div>
          <Button size="sm" className="mt-3" loading={change.isPending} disabled={!email || (me.user.hasPassword && !password)} onClick={() => change.mutate(undefined)}>Send confirmation link</Button>
          <p className="mt-2 text-[12px] text-muted">Your email changes after you click the link sent to the new address.</p>
        </div>
      </div>
    </Section>
  );
}

function WorkspaceSection() {
  const me = useMe();
  const can = useCan();
  const s = me.workspace.settings;
  const initial = { name: me.workspace.name, agencyName: s.agencyName ?? '', website: s.website ?? '', industry: s.industry ?? '', businessLocation: s.businessLocation ?? '', defaultSenderName: s.defaultSenderName ?? '' };
  const [form, setForm] = useState(initial);
  const [location, setLocation] = useState(s.defaultLocation);
  const save = useAction(() => api.patch('/api/workspace', { ...form, defaultLocation: location }), { success: 'Workspace saved', invalidate: [['me']] });
  const { config } = useSession();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || JSON.stringify(location) !== JSON.stringify(s.defaultLocation);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <Section title="Workspace" description="Shared by everyone in this workspace.">
        {!can.manageWorkspace && <Notice tone="neutral" className="mb-4">Only owners and admins can change workspace settings.</Notice>}
        <fieldset disabled={!can.manageWorkspace} className="grid gap-4 sm:grid-cols-2">
          <Field label="Workspace name" htmlFor="w-name" className="sm:col-span-2"><Input id="w-name" value={form.name} onChange={set('name')} /></Field>
          <Field label="Business or agency name" htmlFor="w-agency" hint="Used for {{agencyName}}"><Input id="w-agency" value={form.agencyName} onChange={set('agencyName')} /></Field>
          <Field label="Default sender" htmlFor="w-sender" hint="Used for {{senderName}}"><Input id="w-sender" value={form.defaultSenderName} onChange={set('defaultSenderName')} /></Field>
          <Field label="Website" htmlFor="w-web"><Input id="w-web" value={form.website} onChange={set('website')} /></Field>
          <Field label="Default industry" htmlFor="w-ind"><Input id="w-ind" value={form.industry} onChange={set('industry')} /></Field>
          <Field label="Business location" htmlFor="w-loc"><Input id="w-loc" value={form.businessLocation} onChange={set('businessLocation')} /></Field>
          <Field label="Default search location" className="sm:col-span-2" hint="Discover opens here.">
            <LocationSearch value={location} onChange={(l) => setLocation(l)} placesEnabled={Boolean(config?.features.places)} />
          </Field>
        </fieldset>
      </Section>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate(undefined)} onReset={() => { setForm(initial); setLocation(s.defaultLocation); }} />
    </>
  );
}

function TeamSection() {
  const me = useMe();
  const can = useCan();
  const { data, isLoading } = useApi<{ members: { id: string; userId: string; name: string; email: string; avatarUrl: string | null; role: Role; joinedAt: string }[]; invitations: { id: string; email: string; role: Role; expiresAt: string }[] }>(['members'], '/api/workspace/members');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const inv = [['members']] as unknown[][];
  const invite = useAction(() => api.post('/api/workspace/invitations', { email, role }), { success: `Invitation sent to ${email}`, invalidate: inv, onSuccess: () => setEmail('') });
  const revoke = useAction((id: string) => api.delete(`/api/workspace/invitations/${id}`), { success: 'Invitation revoked', invalidate: inv });
  const changeRole = useAction((v: { userId: string; role: Role }) => api.patch(`/api/workspace/members/${v.userId}`, { role: v.role }), { success: 'Role updated', invalidate: [...inv, ['me']] });
  const remove = useAction((userId: string) => api.delete(`/api/workspace/members/${userId}`), { success: 'Member removed', invalidate: inv, onSuccess: (_r, uid) => { setRemoving(null); if (uid === me.user.id) window.location.href = '/app'; } });
  return (
    <Section title="Team" description="Invite teammates and manage roles. Owners and admins manage settings, billing and members; members work with prospects and campaigns.">
      {can.manageWorkspace && (
        <div className="mb-5 flex flex-wrap gap-2">
          <Input type="email" placeholder="teammate@studio.com" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-[220px] flex-1" aria-label="Email to invite" />
          <Select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')} className="w-[120px]" aria-label="Role">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
          <Button variant="primary" leftIcon={<Plus />} disabled={!email} loading={invite.isPending} onClick={() => invite.mutate(undefined)}>Invite</Button>
        </div>
      )}
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {data?.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar name={m.name} src={m.avatarUrl} size={30} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{m.name}{m.userId === me.user.id && <span className="text-muted"> (you)</span>}</div>
                <div className="truncate text-[12px] text-muted">{m.email} &middot; joined {formatDate(m.joinedAt)}</div>
              </div>
              {can.manageWorkspace && m.userId !== me.user.id && m.role !== 'owner' ? (
                <Select size="sm" value={m.role} onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as Role })} className="w-[120px]" aria-label={`Role for ${m.name}`}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  {can.isOwner && <option value="owner">Make owner</option>}
                </Select>
              ) : (
                <Badge tone={m.role === 'owner' ? 'solid' : 'neutral'}>{ROLE_LABELS[m.role]}</Badge>
              )}
              {m.role !== 'owner' && (m.userId === me.user.id || can.manageWorkspace) && (
                <Button size="xs" variant="ghost" onClick={() => setRemoving({ userId: m.userId, name: m.name })}>{m.userId === me.user.id ? 'Leave' : 'Remove'}</Button>
              )}
            </li>
          ))}
          {data?.invitations.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex size-[30px] items-center justify-center rounded-full border border-dashed border-line-strong text-[11px] text-muted">?</div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px]">{i.email}</div>
                <div className="text-[12px] text-muted">Invitation pending &middot; expires {formatDate(i.expiresAt)}</div>
              </div>
              <Badge tone="outline">{ROLE_LABELS[i.role]}</Badge>
              {can.manageWorkspace && <Button size="xs" variant="ghost" onClick={() => revoke.mutate(i.id)}>Revoke</Button>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} title={removing?.userId === me.user.id ? 'Leave this workspace?' : `Remove ${removing?.name}?`} description="They lose access to this workspace immediately. Their prospects, notes and campaigns stay in the workspace." confirmLabel={removing?.userId === me.user.id ? 'Leave workspace' : 'Remove member'} destructive loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.userId)} />
    </Section>
  );
}

function EmailSection() {
  const me = useMe();
  const can = useCan();
  const s = me.workspace.settings;
  const initial = { defaultSenderName: s.defaultSenderName ?? '', defaultReplyTo: s.defaultReplyTo ?? '', signature: s.signature ?? '', postalAddress: s.postalAddress ?? '', includeUnsubscribeFooter: s.includeUnsubscribeFooter };
  const [form, setForm] = useState(initial);
  const save = useAction(() => api.patch('/api/workspace', form), { success: 'Email settings saved', invalidate: [['me']] });
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  return (
    <>
      <Section title="Email" description="Defaults applied to every outreach email from this workspace.">
        <fieldset disabled={!can.manageWorkspace} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default sender name" htmlFor="e-sender"><Input id="e-sender" value={form.defaultSenderName} onChange={(e) => setForm({ ...form, defaultSenderName: e.target.value })} /></Field>
            <Field label="Reply-to address" htmlFor="e-reply" optional><Input id="e-reply" type="email" value={form.defaultReplyTo} onChange={(e) => setForm({ ...form, defaultReplyTo: e.target.value })} /></Field>
          </div>
          <Field label="Signature" htmlFor="e-sig" hint="Added below every outreach email.">
            <Textarea id="e-sig" rows={4} value={form.signature} onChange={(e) => setForm({ ...form, signature: e.target.value })} placeholder={'Alex Morgan\nMorgan Studio\nmorganstudio.com'} />
          </Field>
          <Field label="Postal address" htmlFor="e-addr" hint="Anti-spam laws such as CAN-SPAM require a physical postal address in commercial email.">
            <Input id="e-addr" value={form.postalAddress} onChange={(e) => setForm({ ...form, postalAddress: e.target.value })} />
          </Field>
          <label className="flex items-start justify-between gap-4 rounded-lg border border-line p-4">
            <span>
              <span className="block text-[13.5px] font-medium">Include an unsubscribe link</span>
              <span className="block text-[12.5px] text-muted">Strongly recommended and legally required in many countries. Opt-outs are honored across the workspace.</span>
            </span>
            <Switch checked={form.includeUnsubscribeFooter} onCheckedChange={(v) => setForm({ ...form, includeUnsubscribeFooter: v })} label="Include unsubscribe link" />
          </label>
          {!form.includeUnsubscribeFooter && <Notice tone="warning">Without an unsubscribe link, recipients can only opt out by replying. Make sure your outreach complies with the laws where your recipients are.</Notice>}
        </fieldset>
      </Section>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate(undefined)} onReset={() => setForm(initial)} />
    </>
  );
}

function DiscoverySection() {
  const me = useMe();
  const can = useCan();
  const s = me.workspace.settings;
  const initial = { defaultRadiusMeters: s.defaultRadiusMeters, defaultCategories: s.defaultCategories, minRating: s.minRating, maxRating: s.maxRating, websiteFilter: s.websiteFilter };
  const [form, setForm] = useState(initial);
  const save = useAction(() => api.patch('/api/workspace', form), { success: 'Discovery defaults saved', invalidate: [['me']] });
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  return (
    <>
      <Section title="Discovery" description="Default search settings in Discover.">
        <fieldset disabled={!can.manageWorkspace} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default radius">
              <Select value={form.defaultRadiusMeters} onChange={(e) => setForm({ ...form, defaultRadiusMeters: Number(e.target.value) })} aria-label="Default radius">
                {RADIUS_PRESETS_KM.map((k) => <option key={k} value={k * 1000}>{k} km</option>)}
              </Select>
            </Field>
            <Field label="Website filter">
              <Select value={form.websiteFilter} onChange={(e) => setForm({ ...form, websiteFilter: e.target.value as WebsiteFilter })} aria-label="Website filter">
                {WEBSITE_FILTERS.map((w) => <option key={w} value={w}>{WEBSITE_FILTER_LABELS[w]}</option>)}
              </Select>
            </Field>
            <Field label="Minimum rating">
              <Select value={form.minRating ?? ''} onChange={(e) => setForm({ ...form, minRating: e.target.value ? Number(e.target.value) : null })} aria-label="Minimum rating">
                <option value="">Any</option>
                {[3, 3.5, 4, 4.5].map((r) => <option key={r} value={r}>{r}+</option>)}
              </Select>
            </Field>
            <Field label="Maximum rating">
              <Select value={form.maxRating ?? ''} onChange={(e) => setForm({ ...form, maxRating: e.target.value ? Number(e.target.value) : null })} aria-label="Maximum rating">
                <option value="">Any</option>
                {[3.5, 4, 4.5].map((r) => <option key={r} value={r}>{r} or lower</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Default categories">
            <div className="flex flex-wrap gap-1.5">
              {BUSINESS_CATEGORIES.map((c) => (
                <button key={c.id} type="button" aria-pressed={form.defaultCategories.includes(c.id)} onClick={() => setForm((f) => ({ ...f, defaultCategories: f.defaultCategories.includes(c.id) ? f.defaultCategories.filter((x) => x !== c.id) : [...f.defaultCategories, c.id].slice(0, 20) }))} className={cn('h-7 rounded-md border px-2.5 text-[12.5px] transition-colors', form.defaultCategories.includes(c.id) ? 'border-ink bg-ink text-white' : 'border-line bg-panel hover:border-line-strong')}>
                  {c.label}
                </button>
              ))}
            </div>
          </Field>
        </fieldset>
      </Section>
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate(undefined)} onReset={() => setForm(initial)} />
    </>
  );
}

function NotificationsSection() {
  const { data, isLoading } = useApi<{ preferences: NotificationPreferences }>(['notification-prefs'], '/api/me/notification-preferences');
  const save = useAction((p: Partial<NotificationPreferences>) => api.put('/api/me/notification-preferences', p), { invalidate: [['notification-prefs']], success: 'Preferences saved' });
  const labels: Record<string, [string, string]> = {
    campaign_completed: ['Campaign completed', 'When every recipient has finished a sequence.'],
    replies: ['Replies', 'When a prospect replies to your outreach.'],
    follow_ups: ['Follow-ups', 'When a follow-up reminder you scheduled is due.'],
    usage_limits: ['Usage limits', "When you're approaching or reach a plan limit."],
  };
  return (
    <Section title="Notifications" description="Choose how Localy lets you know about important events. Security and billing notices are always sent.">
      {isLoading || !data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="grid grid-cols-[1fr_72px_72px] gap-3 border-b border-line bg-canvas/60 px-4 py-2 text-[11.5px] font-medium uppercase tracking-wider text-subtle">
            <span>Event</span>
            <span className="text-center">In app</span>
            <span className="text-center">Email</span>
          </div>
          {NOTIFICATION_PREFERENCE_KEYS.map((k) => (
            <div key={k} className="grid grid-cols-[1fr_72px_72px] items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <div>
                <div className="text-[13.5px] font-medium">{labels[k][0]}</div>
                <div className="text-[12px] text-muted">{labels[k][1]}</div>
              </div>
              <div className="flex justify-center"><Switch checked={data.preferences[k].inApp} onCheckedChange={(v) => save.mutate({ [k]: { ...data.preferences[k], inApp: v } })} label={`${labels[k][0]} in app`} /></div>
              <div className="flex justify-center"><Switch checked={data.preferences[k].email} onCheckedChange={(v) => save.mutate({ [k]: { ...data.preferences[k], email: v } })} label={`${labels[k][0]} by email`} /></div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SecuritySection() {
  const me = useMe();
  const qc = useQueryClient();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwErrors, setPwErrors] = useState<Record<string, string[]>>({});
  const sessions = useApi<{ sessions: { id: string; userAgent: string | null; ip: string | null; createdAt: string; lastSeenAt: string; current: boolean }[] }>(['sessions'], '/api/auth/sessions');
  const tfa = useApi<{ enabled: boolean; recoveryCodesRemaining: number }>(['2fa'], '/api/auth/two-factor/status');
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePw, setDisablePw] = useState('');
  const changePw = useAction(() => api.post<{ otherSessionsRevoked: number }>('/api/auth/change-password', { currentPassword: pw.currentPassword || undefined, newPassword: pw.newPassword }), {
    success: (r) => `Password updated${r.otherSessionsRevoked ? `. Signed out of ${r.otherSessionsRevoked} other ${r.otherSessionsRevoked === 1 ? 'session' : 'sessions'}` : ''}`,
    invalidate: [['sessions'], ['me']],
    onSuccess: () => { setPw({ currentPassword: '', newPassword: '' }); setPwErrors({}); },
    onError: (e: ApiError) => setPwErrors(e.fields),
  });
  const revoke = useAction((id: string) => api.delete(`/api/auth/sessions/${id}`), { success: 'Session signed out', invalidate: [['sessions']] });
  const revokeOthers = useAction(() => api.post<{ revoked: number }>('/api/auth/sessions/revoke-others'), { success: (r) => `Signed out of ${r.revoked} other ${r.revoked === 1 ? 'session' : 'sessions'}`, invalidate: [['sessions']] });
  const startSetup = useAction(() => api.post<{ secret: string; qrDataUrl: string }>('/api/auth/two-factor/setup'), { onSuccess: (r) => setSetup(r) });
  const enable = useAction(() => api.post<{ recoveryCodes: string[] }>('/api/auth/two-factor/enable', { code }), { success: 'Two-factor authentication enabled', invalidate: [['2fa'], ['me']], onSuccess: (r) => { setSetup(null); setCode(''); setCodes(r.recoveryCodes); } });
  const disable = useAction(() => api.post('/api/auth/two-factor/disable', { password: disablePw || undefined }), { success: 'Two-factor authentication disabled', invalidate: [['2fa'], ['me']], onSuccess: () => { setDisableOpen(false); setDisablePw(''); } });
  const regen = useAction(() => api.post<{ recoveryCodes: string[] }>('/api/auth/two-factor/recovery-codes', { password: disablePw || undefined }), { invalidate: [['2fa']], onSuccess: (r) => setCodes(r.recoveryCodes) });
  const pwCheck = checkPassword(pw.newPassword);
  void qc;
  const deviceIcon = (ua: string | null) => (/(iphone|android|mobile)/i.test(ua ?? '') ? Smartphone : /mac|windows|linux/i.test(ua ?? '') ? Laptop : Monitor);
  const deviceLabel = (ua: string | null) => {
    if (!ua) return 'Unknown device';
    const browser = /edg\//i.test(ua) ? 'Edge' : /chrome/i.test(ua) ? 'Chrome' : /firefox/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser';
    const os = /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'macOS' : /android/i.test(ua) ? 'Android' : /iphone|ipad/i.test(ua) ? 'iOS' : /linux/i.test(ua) ? 'Linux' : '';
    return `${browser}${os ? ` on ${os}` : ''}`;
  };
  return (
    <>
      <Section title="Password" description={me.user.hasPassword ? 'Changing your password signs you out of other devices.' : 'You sign in with Google. Set a password to also sign in with email.'}>
        <div className="grid max-w-md gap-4">
          {me.user.hasPassword && <Field label="Current password" htmlFor="s-cur" error={pwErrors.currentPassword}><Input id="s-cur" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>}
          <Field label="New password" htmlFor="s-new" error={pwErrors.password}>
            <Input id="s-new" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
              {PASSWORD_RULES.filter((r) => r.id !== 'max').map((r) => <li key={r.id} className={r.test(pw.newPassword) ? 'text-positive' : 'text-muted'}>{r.label}</li>)}
            </ul>
          </Field>
          <div><Button variant="primary" size="sm" disabled={!pwCheck.valid || (me.user.hasPassword && !pw.currentPassword)} loading={changePw.isPending} onClick={() => changePw.mutate(undefined)}>{me.user.hasPassword ? 'Update password' : 'Set password'}</Button></div>
        </div>
      </Section>
      <Section title="Two-factor authentication" description="Require a code from an authenticator app when signing in.">
        {tfa.isLoading ? <Skeleton className="h-16" /> : tfa.data?.enabled ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[13.5px]"><ShieldCheck className="size-4 text-positive" /> Enabled &middot; {tfa.data.recoveryCodesRemaining} recovery codes remaining</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => regen.mutate(undefined)} loading={regen.isPending}>Generate new recovery codes</Button>
              <Button size="sm" variant="ghost" onClick={() => setDisableOpen(true)}>Disable</Button>
            </div>
          </div>
        ) : setup ? (
          <div className="flex flex-wrap items-start gap-6">
            <img src={setup.qrDataUrl} alt="QR code for your authenticator app" className="size-[180px] rounded-lg border border-line" />
            <div className="min-w-[240px] flex-1 space-y-3">
              <p className="text-[13px] text-muted">Scan the QR code with an authenticator app, or enter this key manually:</p>
              <code className="block break-all rounded-md bg-wash px-3 py-2 font-mono text-[12.5px]">{setup.secret}</code>
              <Field label="Enter the 6-digit code" htmlFor="s-code"><Input id="s-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-[160px] tracking-widest" /></Field>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" disabled={code.length < 6} loading={enable.isPending} onClick={() => enable.mutate(undefined)}>Verify and enable</Button>
                <Button size="sm" onClick={() => setSetup(null)}>Cancel</Button>
              </div>
            </div>
          </div>
        ) : (
          <Button size="sm" leftIcon={<KeyRound />} loading={startSetup.isPending} onClick={() => startSetup.mutate(undefined)}>Set up two-factor authentication</Button>
        )}
      </Section>
      <Section title="Active sessions" description="Devices currently signed in to your account." action={<Button size="sm" leftIcon={<LogOut />} loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate(undefined)}>Sign out all other devices</Button>}>
        {sessions.isLoading ? <Skeleton className="h-24" /> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {sessions.data?.sessions.map((s) => {
              const Icon = deviceIcon(s.userAgent);
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <Icon className="size-4 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium">{deviceLabel(s.userAgent)} {s.current && <Badge tone="positive" className="ml-1">This device</Badge>}</div>
                    <div className="text-[12px] text-muted">{s.ip ?? 'Unknown IP'} &middot; signed in {formatDate(s.createdAt)} &middot; active {timeAgo(s.lastSeenAt)}</div>
                  </div>
                  {!s.current && <Button size="xs" variant="ghost" onClick={() => revoke.mutate(s.id)}>Sign out</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Dialog open={Boolean(codes)} onOpenChange={(o) => !o && setCodes(null)} title="Save your recovery codes" description="Each code can be used once to sign in if you lose access to your authenticator. They won't be shown again." footer={<Button variant="primary" onClick={() => setCodes(null)}>I've saved them</Button>}>
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-wash p-4 font-mono text-[13px]">{codes?.map((c) => <span key={c}>{c}</span>)}</div>
        <Button size="sm" className="mt-3" leftIcon={<Copy />} onClick={() => { void navigator.clipboard.writeText(codes?.join('\n') ?? ''); toast.success('Copied'); }}>Copy codes</Button>
      </Dialog>
      <Dialog open={disableOpen} onOpenChange={setDisableOpen} title="Disable two-factor authentication?" size="sm" footer={<><Button onClick={() => setDisableOpen(false)}>Cancel</Button><Button variant="danger" loading={disable.isPending} onClick={() => disable.mutate(undefined)}>Disable</Button></>}>
        <Field label="Confirm your password" htmlFor="d-pw"><Input id="d-pw" type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} /></Field>
      </Dialog>
    </>
  );
}

function ApiSection() {
  const can = useCan();
  const { data, isLoading, error } = useApi<{ keys: { id: string; name: string; prefix: string; scope: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string; createdBy: string | null }[] }>(['api-keys'], can.manageWorkspace ? '/api/api-keys' : null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [created, setCreated] = useState<string | null>(null);
  const create = useAction(() => api.post<{ key: string }>('/api/api-keys', { name, scope }), { invalidate: [['api-keys']], onSuccess: (r) => { setCreated(r.key); setName(''); } });
  const revoke = useAction((id: string) => api.delete(`/api/api-keys/${id}`), { success: 'API key revoked', invalidate: [['api-keys']] });
  if (!can.manageWorkspace) return <Section title="API keys" description="Programmatic access to your workspace."><Notice tone="neutral">Only owners and admins can manage API keys.</Notice></Section>;
  return (
    <Section title="API keys" description="Access your prospects, campaigns and templates programmatically. Keys are shown once and stored hashed.">
      <div className="mb-4 flex flex-wrap gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, for example CRM sync" className="min-w-[220px] flex-1" aria-label="Key name" />
        <Select value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'write')} className="w-[130px]" aria-label="Scope">
          <option value="read">Read only</option>
          <option value="write">Read and write</option>
        </Select>
        <Button variant="primary" leftIcon={<Plus />} disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate(undefined)}>Create key</Button>
      </div>
      {error ? <Notice tone="neutral">{error.message}</Notice> : isLoading ? <Skeleton className="h-16" /> : !data?.keys.length ? (
        <p className="text-[13px] text-muted">No API keys yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {data.keys.map((k) => (
            <li key={k.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', k.revokedAt && 'opacity-50')}>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{k.name}</div>
                <div className="text-[12px] text-muted"><code className="font-mono">{k.prefix}...</code> &middot; {k.scope === 'read' ? 'Read only' : 'Read and write'} &middot; created {formatDate(k.createdAt)}{k.createdBy && ` by ${k.createdBy}`} &middot; {k.lastUsedAt ? `last used ${timeAgo(k.lastUsedAt)}` : 'never used'}</div>
              </div>
              {k.revokedAt ? <Badge>Revoked</Badge> : <Button size="xs" variant="ghost" onClick={() => revoke.mutate(k.id)}>Revoke</Button>}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 rounded-lg border border-line bg-canvas/60 p-4 text-[12.5px]">
        <div className="mb-1 font-medium">Usage</div>
        <code className="block overflow-x-auto whitespace-pre font-mono text-[12px] text-muted">{`curl -H "Authorization: Bearer lcl_..." ${window.location.origin}/api/v1/prospects`}</code>
        <p className="mt-2 text-muted">Endpoints: GET /api/v1/prospects, /api/v1/prospects/:id, /api/v1/campaigns, /api/v1/templates. Business details from Google Maps are not returned by the API.</p>
      </div>
      <Dialog open={Boolean(created)} onOpenChange={(o) => !o && setCreated(null)} title="Copy your API key" description="This is the only time the full key is shown. Store it securely." footer={<Button variant="primary" onClick={() => setCreated(null)}>Done</Button>}>
        <code className="block break-all rounded-md bg-wash px-3 py-2.5 font-mono text-[12.5px]">{created}</code>
        <Button size="sm" className="mt-3" leftIcon={<Copy />} onClick={() => { void navigator.clipboard.writeText(created ?? ''); toast.success('Copied'); }}>Copy key</Button>
      </Dialog>
    </Section>
  );
}

function AuditSection() {
  const can = useCan();
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useApi<{ items: { id: string; action: string; actorEmail: string | null; targetType: string | null; ip: string | null; createdAt: string; metadata: Record<string, unknown> }[] }>(['audit', page], can.manageWorkspace ? `/api/audit-logs?page=${page}` : null);
  return (
    <Section title="Audit log" description="Security-relevant actions in this workspace.">
      {!can.manageWorkspace ? <Notice tone="neutral">Only owners and admins can view the audit log.</Notice> : error ? <Notice tone="danger">{error.message}</Notice> : isLoading ? <Skeleton className="h-40" /> : !data?.items.length ? <p className="text-[13px] text-muted">No events yet.</p> : (
        <>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {data.items.map((e) => (
              <li key={e.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="font-mono text-[12.5px] text-ink">{e.action}</div>
                  <div className="truncate text-[12px] text-muted">{e.actorEmail ?? 'System'}{e.ip && ` \u00b7 ${e.ip}`}{Object.keys(e.metadata).length > 0 && ` \u00b7 ${JSON.stringify(e.metadata).slice(0, 80)}`}</div>
                </div>
                <span className="text-[12px] text-subtle">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
            <Button size="xs" disabled={(data.items.length ?? 0) < 50} onClick={() => setPage((p) => p + 1)}>Older</Button>
          </div>
        </>
      )}
    </Section>
  );
}

function DataSection() {
  const can = useCan();
  const [busy, setBusy] = useState(false);
  const exportAll = async () => {
    setBusy(true);
    try {
      await download('/api/me/export', 'localy-export.json');
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Data and privacy" description="Export what you've created in Localy, and understand what Localy stores.">
      <div className="space-y-4 text-[13px]">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-4">
          <div>
            <div className="font-medium">Export workspace data</div>
            <div className="text-muted">Prospects, notes, tags, templates, campaigns, emails and settings as JSON.</div>
          </div>
          <Button leftIcon={<Download />} loading={busy} disabled={!can.manageWorkspace} onClick={exportAll}>Export JSON</Button>
        </div>
        <div className="rounded-lg border border-line p-4 leading-relaxed text-muted">
          <div className="mb-1 font-medium text-ink">What Localy stores from Google Maps</div>
          Only place IDs (to re-identify businesses), plus search coordinates for at most 30 days, as permitted by the Google Maps Platform terms. Business names, addresses, phone numbers, ratings, hours and websites are fetched live when you view them and are never stored or exported. Your own entries (contact names, emails, notes) are yours and fully exportable.
        </div>
        <p className="text-muted">Read the <a href="/privacy" className="font-medium text-ink hover:underline">Privacy Policy</a>, <a href="/terms" className="font-medium text-ink hover:underline">Terms of Service</a> and <a href="/cookies" className="font-medium text-ink hover:underline">Cookie Policy</a>.</p>
      </div>
    </Section>
  );
}

function DangerSection() {
  const me = useMe();
  const can = useCan();
  const { signOut } = useSession();
  const [wsOpen, setWsOpen] = useState(false);
  const [wsName, setWsName] = useState('');
  const [accOpen, setAccOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const delWs = useAction(() => api.post('/api/workspace/delete', { confirmName: wsName }), { success: 'Workspace deleted', onSuccess: () => (window.location.href = '/app') });
  const delAcc = useAction(() => api.post('/api/me/delete', { confirm, password: password || undefined }), { success: 'Your account has been deleted', onSuccess: () => void signOut() });
  return (
    <Section title="Danger zone" description="Permanent actions. There is no undo.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#f5c6c1] p-4">
          <div className="text-[13px]">
            <div className="font-medium">Delete workspace</div>
            <div className="text-muted">Deletes {me.workspace.name} and all its prospects, campaigns and email history, and cancels its subscription.</div>
          </div>
          <Button variant="danger" disabled={!can.isOwner || me.workspaces.length < 2} onClick={() => setWsOpen(true)}>Delete workspace</Button>
        </div>
        {me.workspaces.length < 2 && can.isOwner && <p className="text-[12px] text-muted">This is your only workspace. Delete your account to remove it.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#f5c6c1] p-4">
          <div className="text-[13px]">
            <div className="font-medium">Delete account</div>
            <div className="text-muted">Deletes your user account. Workspaces you own alone are deleted with all their data. Transfer ownership of shared workspaces first.</div>
          </div>
          <Button variant="danger" onClick={() => setAccOpen(true)}>Delete account</Button>
        </div>
      </div>
      <ConfirmDialog open={wsOpen} onOpenChange={setWsOpen} title="Delete this workspace?" description={`Type "${me.workspace.name}" to confirm.`} confirmLabel="Delete workspace" destructive loading={delWs.isPending} onConfirm={() => wsName === me.workspace.name && delWs.mutate(undefined)}>
        <Input value={wsName} onChange={(e) => setWsName(e.target.value)} aria-label="Workspace name" />
      </ConfirmDialog>
      <ConfirmDialog open={accOpen} onOpenChange={setAccOpen} title="Delete your account?" description="Type DELETE to confirm. Active subscriptions on workspaces you own alone are canceled." confirmLabel="Delete account permanently" destructive loading={delAcc.isPending} onConfirm={() => confirm === 'DELETE' && delAcc.mutate(undefined)}>
        <div className="space-y-3">
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" aria-label="Type DELETE" />
          {me.user.hasPassword && <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" aria-label="Password" autoComplete="current-password" />}
        </div>
      </ConfirmDialog>
    </Section>
  );
}

function LinkOut({ to, label, description }: { to: string; label: string; description: string }) {
  const navigate = useNavigate();
  return (
    <Section title={label} description={description}>
      <Button onClick={() => navigate(to)}>Open {label.toLowerCase()}</Button>
    </Section>
  );
}

export default function SettingsPage() {
  const { section = 'profile' } = useParams();
  const content: Record<string, ReactNode> = {
    profile: <ProfileSection />,
    account: <AccountSection />,
    workspace: <WorkspaceSection />,
    team: <TeamSection />,
    email: <EmailSection />,
    discovery: <DiscoverySection />,
    notifications: <NotificationsSection />,
    security: <SecuritySection />,
    billing: <LinkOut to="/app/billing" label="Billing" description="Plan, usage, payment method and invoices." />,
    integrations: <LinkOut to="/app/integrations" label="Integrations" description="Connected Gmail and Outlook mailboxes." />,
    api: <ApiSection />,
    audit: <AuditSection />,
    data: <DataSection />,
    danger: <DangerSection />,
  };
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-6 md:grid-cols-[200px_minmax(0,1fr)] md:px-8">
        <nav className="flex gap-1 overflow-x-auto md:sticky md:top-6 md:flex-col md:self-start" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <NavLink key={s.id} to={`/app/settings/${s.id}`} className={({ isActive }) => cn('shrink-0 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors', isActive || (s.id === 'profile' && section === 'profile') ? 'bg-panel text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:bg-hover hover:text-ink', s.id === 'danger' && 'text-danger')}>
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div key={section} className="page-enter min-w-0">{content[section] ?? <EmptyState title="Section not found" />}</div>
      </div>
    </>
  );
}

