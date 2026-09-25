import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  BarChart3,
  Building2,
  ChevronsUpDown,
  CreditCard,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Map,
  Megaphone,
  Menu as MenuIcon,
  Plug,
  Plus,
  Search,
  Settings,
  Check,
  HelpCircle,
  Keyboard,
  CalendarClock,
  X,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { useMe, useSession } from '@/lib/session';
import { cn, isTypingTarget } from '@/lib/utils';
import { Avatar, Button, Dialog, Field, Input, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Notice } from '@/components/ui';
import { Logo } from './logo';
import { CommandMenu } from './command-menu';
import { ShortcutsDialog } from './shortcuts';
import { NotificationBell } from './notifications';

const workspaceNav = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/discover', label: 'Discover', icon: Map },
  { to: '/app/prospects', label: 'Prospects', icon: Building2 },
  { to: '/app/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/app/templates', label: 'Templates', icon: FileText },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
];
const accountNav = [
  { to: '/app/inbox', label: 'Inbox', icon: Inbox },
  { to: '/app/follow-ups', label: 'Follow-ups', icon: CalendarClock },
  { to: '/app/integrations', label: 'Integrations', icon: Plug },
  { to: '/app/billing', label: 'Billing', icon: CreditCard },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

function NavItem({ to, label, icon: Icon, end, badge, onNavigate }: { to: string; label: string; icon: typeof Map; end?: boolean; badge?: ReactNode; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium transition-colors',
          isActive ? 'bg-panel text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:bg-hover hover:text-ink',
        )
      }
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.8} />
      <span className="flex-1 truncate">{label}</span>
      {badge}
    </NavLink>
  );
}

function WorkspaceSwitcher() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const switchTo = async (id: string) => {
    if (id === me.workspace.id) return;
    try {
      await api.post('/api/workspaces/switch', { workspaceId: id });
      qc.clear();
      navigate('/app');
      window.location.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const create = async () => {
    setBusy(true);
    try {
      await api.post('/api/workspaces', { name });
      qc.clear();
      window.location.href = '/app';
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover" aria-label="Account and workspace menu">
            <Avatar name={me.user.name} src={me.user.avatarUrl} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{me.user.name}</span>
              <span className="block truncate text-[11.5px] text-muted">{me.workspace.name}</span>
            </span>
            <ChevronsUpDown className="size-3.5 text-subtle" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" className="w-[248px]">
          <MenuLabel>Workspaces</MenuLabel>
          {me.workspaces.map((w) => (
            <MenuItem key={w.id} onSelect={() => switchTo(w.id)} icon={w.id === me.workspace.id ? <Check /> : <span className="size-4" />}>
              {w.name}
            </MenuItem>
          ))}
          <MenuItem icon={<Plus />} onSelect={() => setCreating(true)}>
            New workspace
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Settings />} onSelect={() => navigate('/app/settings')}>
            Settings
          </MenuItem>
          <MenuItem icon={<Keyboard />} onSelect={() => window.dispatchEvent(new CustomEvent('localy:shortcuts'))}>
            Keyboard shortcuts
          </MenuItem>
          <MenuItem icon={<HelpCircle />} onSelect={() => navigate('/app/help')}>
            Help
          </MenuItem>
          {me.user.isPlatformAdmin && (
            <MenuItem icon={<ShieldCheck />} onSelect={() => navigate('/admin')}>
              Admin
            </MenuItem>
          )}
          <MenuSeparator />
          <SignOutItem />
        </MenuContent>
      </Menu>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Create a workspace"
        description="Workspaces keep prospects, campaigns and billing completely separate."
        size="sm"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={create}>
              Create workspace
            </Button>
          </>
        }
      >
        <Field label="Workspace name" htmlFor="ws-name">
          <Input id="ws-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Studio" onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} />
        </Field>
      </Dialog>
    </>
  );
}

function SignOutItem() {
  const { signOut } = useSession();
  return (
    <MenuItem icon={<LogOut />} onSelect={() => void signOut()}>
      Sign out
    </MenuItem>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Logo />
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4 pt-2" aria-label="Main">
        <div>
          <div className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">Workspace</div>
          <div className="space-y-0.5">
            {workspaceNav.map((n) => (
              <NavItem key={n.to} {...n} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
        <div>
          <div className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">Account</div>
          <div className="space-y-0.5">
            {accountNav.map((n) => (
              <NavItem key={n.to} {...n} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      </nav>
      {me.billing.status === 'trialing' && me.billing.trialEndsAt && (
        <div className="mx-3 mb-2 rounded-lg border border-line bg-panel px-3 py-2.5 text-[12px]">
          <div className="font-medium text-ink">Free trial</div>
          <div className="mt-0.5 text-muted">
            {Math.max(0, Math.ceil((new Date(me.billing.trialEndsAt).getTime() - Date.now()) / 86_400_000))} days left.{' '}
            <NavLink to="/app/billing" className="font-medium text-ink underline-offset-2 hover:underline" onClick={onNavigate}>
              Choose a plan
            </NavLink>
          </div>
        </div>
      )}
      <div className="border-t border-line p-2">
        <WorkspaceSwitcher />
      </div>
    </div>
  );
}

export function AppShell() {
  const me = useMe();
  const { config } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const pendingG = useRef(false);

  useEffect(() => setMobileNav(false), [location.pathname]);

  useEffect(() => {
    const onShortcuts = () => setShortcutsOpen(true);
    window.addEventListener('localy:shortcuts', onShortcuts);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) return;
      const k = e.key;
      if (pendingG.current) {
        pendingG.current = false;
        if (k === 'p') navigate('/app/prospects');
        else if (k === 'i') navigate('/app/inbox');
        else if (k === 'c') navigate('/app/campaigns');
        else if (k === 'd') navigate('/app/discover');
        else if (k === 'h') navigate('/app');
        return;
      }
      if (k === '/') {
        e.preventDefault();
        setCmdOpen(true);
      } else if (k === '?') setShortcutsOpen(true);
      else if (k === 'n') navigate('/app/prospects?new=1');
      else if (k === 'c') navigate('/app/campaigns/new');
      else if (k === 't') navigate('/app/templates?new=1');
      else if (k === 'd') navigate('/app/discover');
      else if (k === 'g') {
        pendingG.current = true;
        setTimeout(() => (pendingG.current = false), 900);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('localy:shortcuts', onShortcuts);
    };
  }, [navigate]);

  const isFullBleed = location.pathname.startsWith('/app/discover') || location.pathname.startsWith('/app/inbox') || location.pathname === '/app/compose' || location.pathname === '/app/prospects';
  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <aside className="hidden w-[232px] shrink-0 border-r border-line bg-wash/60 lg:block">
        <Sidebar />
      </aside>
      {mobileNav && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/25 animate-fade-in" onClick={() => setMobileNav(false)} />
          <aside className="absolute inset-y-0 left-0 w-[260px] border-r border-line bg-canvas shadow-lg animate-[slide-up_180ms_ease-out]">
            <Button variant="ghost" size="icon-sm" className="absolute right-2 top-3.5" aria-label="Close navigation" onClick={() => setMobileNav(false)}>
              <X />
            </Button>
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas px-3 md:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileNav(true)}>
            <MenuIcon />
          </Button>
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="flex h-8 w-full max-w-[380px] items-center gap-2 rounded-md border border-line bg-panel px-2.5 text-[13px] text-subtle shadow-xs transition-colors hover:border-line-strong hover:text-muted"
            aria-label="Search"
          >
            <Search className="size-3.5" />
            <span className="flex-1 truncate text-left">Search prospects, campaigns, notes</span>
            <Kbd className="hidden sm:inline-flex">/</Kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="primary" size="sm" className="hidden sm:inline-flex" leftIcon={<Map />} onClick={() => navigate('/app/discover')}>
              Discover
            </Button>
            <NotificationBell />
          </div>
        </div>
        {config?.announcement && (
          <div className={cn('border-b px-5 py-2 text-center text-[12.5px]', config.announcement.level === 'warning' ? 'border-[#f0dfb8] bg-warning-wash text-[#6b4708]' : 'border-line bg-wash text-ink-2')}>{config.announcement.message}</div>
        )}
        {!me.billing.canUseFeatures && (
          <div className="border-b border-line px-5 py-2">
            <Notice tone="warning" action={<Button size="xs" variant="primary" onClick={() => navigate('/app/billing')}>Choose a plan</Button>}>
              {me.billing.readOnlyReason}
            </Notice>
          </div>
        )}
        {!me.user.emailVerified && <VerifyEmailBanner />}
        <main id="main" className={cn('min-h-0 flex-1', isFullBleed ? 'overflow-hidden' : 'overflow-y-auto')}>
          <Outlet />
        </main>
      </div>
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

function VerifyEmailBanner() {
  const me = useMe();
  const { config } = useSession();
  const [sent, setSent] = useState(false);
  const resend = async () => {
    try {
      await api.post('/api/auth/resend-verification');
      setSent(true);
      toast.success(`Verification email sent to ${me.user.email}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-wash px-5 py-2 text-[12.5px] text-ink-2">
      <span>Confirm your email address ({me.user.email}) to connect a mailbox and send outreach.</span>
      <button type="button" className="font-medium text-ink underline-offset-2 hover:underline disabled:opacity-50" onClick={resend} disabled={sent}>
        {sent ? 'Email sent' : 'Resend email'}
      </button>
      {config?.features.devMail && (
        <a href="/dev/mail" className="font-medium text-ink underline-offset-2 hover:underline">
          Open developer outbox
        </a>
      )}
    </div>
  );
}
