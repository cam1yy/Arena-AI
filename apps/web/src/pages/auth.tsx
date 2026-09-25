import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Circle, Eye, EyeOff, MailCheck } from 'lucide-react';
import { PASSWORD_RULES, checkPassword } from '@localy/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Button, Field, Input, Notice, Spinner } from '@/components/ui';
import { Logo } from '@/components/app/logo';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset' | 'verify' | 'recover' | 'invite';

function AuthLayout({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="flex h-16 items-center px-6">
        <Link to="/" aria-label="Localy home">
          <Logo />
        </Link>
      </div>
      <div className="flex flex-1 items-start justify-center px-5 pb-16 pt-[6vh]">
        <div className="page-enter w-full max-w-[380px]">
          <h1 className="text-[24px] font-semibold tracking-[-0.03em]">{title}</h1>
          {description && <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{description}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-center text-[13.5px] text-muted">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, invalid, placeholder }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <Input
      id={id}
      type={show ? 'text' : 'password'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      invalid={invalid}
      placeholder={placeholder}
      rightSlot={
        <button type="button" className="flex size-7 items-center justify-center rounded-sm text-subtle hover:text-ink" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  );
}

function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="mt-2 grid grid-cols-1 gap-1 text-[12.5px] sm:grid-cols-2" aria-label="Password requirements">
      {PASSWORD_RULES.filter((r) => r.id !== 'max').map((r) => {
        const ok = r.test(password);
        return (
          <li key={r.id} className={cn('flex items-center gap-1.5 transition-colors', ok ? 'text-positive' : 'text-muted')}>
            {ok ? <Check className="size-3.5" /> : <Circle className="size-3" />}
            {r.label}
          </li>
        );
      })}
    </ul>
  );
}

function GoogleButton({ label }: { label: string }) {
  const { config } = useSession();
  const [params] = useSearchParams();
  if (!config?.features.googleSignIn) return null;
  const redirect = params.get('redirect');
  return (
    <>
      <Button variant="secondary" size="lg" className="w-full" asChild>
        <a href={`/api/auth/google${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}>
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
          </svg>
          {label}
        </a>
      </Button>
      <div className="my-5 flex items-center gap-3 text-[12px] text-subtle">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}

function SignIn() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'credentials' | 'two-factor'>(params.get('step') === 'two-factor' ? 'two-factor' : 'credentials');
  const [error, setError] = useState<string | null>(params.get('error'));
  const [busy, setBusy] = useState(false);
  const redirect = params.get('redirect');
  const target = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/app';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'credentials') {
        const res = await api.post<{ twoFactorRequired: boolean }>('/api/auth/signin', { email, password });
        if (res.twoFactorRequired) {
          setStep('two-factor');
          setBusy(false);
          return;
        }
      } else {
        await api.post('/api/auth/two-factor', { code });
      }
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate(target, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (step === 'two-factor') {
    return (
      <AuthLayout title="Two-factor authentication" description="Enter the 6-digit code from your authenticator app, or one of your recovery codes.">
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Authentication code" htmlFor="code">
            <Input id="code" autoFocus inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" className="tracking-widest" />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={code.trim().length < 6}>
            Verify
          </Button>
          <p className="text-center text-[13px] text-muted">
            Lost access to your authenticator? <Link to="/recover" className="font-medium text-ink hover:underline">Account recovery</Link>
          </p>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in to Localy"
      description="Welcome back."
      footer={
        <>
          New to Localy? <Link to="/signup" className="font-medium text-ink hover:underline">Create an account</Link>
        </>
      }
    >
      <GoogleButton label="Continue with Google" />
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@studio.com" />
        </Field>
        <Field label="Password" htmlFor="password" action={<Link to="/forgot-password" className="text-[12.5px] text-muted hover:text-ink">Forgot password?</Link>}>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!email || !password}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

function SignUp() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { config } = useSession();
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pw = checkPassword(form.password);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await api.post('/api/auth/signup', form);
      await qc.invalidateQueries({ queryKey: ['me'] });
      const redirect = new URLSearchParams(window.location.search).get('redirect');
      navigate(redirect?.startsWith('/invite') ? redirect : '/onboarding', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (config && !config.signupsEnabled) {
    return (
      <AuthLayout title="Sign-ups are paused" description="New accounts are temporarily unavailable. Please check back soon.">
        <Button variant="secondary" className="w-full" asChild>
          <Link to="/signin">Sign in instead</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Start your free trial. No credit card required."
      footer={
        <>
          Already have an account? <Link to="/signin" className="font-medium text-ink hover:underline">Sign in</Link>
        </>
      }
    >
      <GoogleButton label="Sign up with Google" />
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Name" htmlFor="name" error={errors.name}>
          <Input id="name" autoComplete="name" autoFocus value={form.name} onChange={set('name')} placeholder="Alex Morgan" invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Work email" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="alex@studio.com" invalid={Boolean(errors.email)} />
        </Field>
        <Field label="Company or workspace name" htmlFor="workspace" error={errors.workspaceName}>
          <Input id="workspace" autoComplete="organization" value={form.workspaceName} onChange={set('workspaceName')} placeholder="Morgan Studio" invalid={Boolean(errors.workspaceName)} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <PasswordInput id="password" value={form.password} onChange={(v) => setForm((f) => ({ ...f, password: v }))} autoComplete="new-password" invalid={Boolean(errors.password)} />
          <PasswordRules password={form.password} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!form.name || !form.email || !form.workspaceName || !pw.valid}>
          Create account
        </Button>
        <p className="text-center text-[12px] leading-relaxed text-subtle">
          By creating an account you agree to the <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </form>
    </AuthLayout>
  );
}

function Forgot({ recovery }: { recovery?: boolean }) {
  const { config } = useSession();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (sent) {
    return (
      <AuthLayout title="Check your email" description={`If an account exists for ${email}, we sent a link to reset your password. The link expires in 60 minutes.`} footer={<Link to="/signin" className="font-medium text-ink hover:underline">Back to sign in</Link>}>
        <div className="flex items-center gap-3 rounded-lg border border-line bg-panel p-4 text-[13.5px] text-muted">
          <MailCheck className="size-5 text-ink" /> Didn't get it? Check spam, or try again in a minute.
        </div>
        {config?.features.devMail && (
          <Button variant="secondary" className="mt-4 w-full" asChild>
            <a href="/dev/mail">Open developer outbox</a>
          </Button>
        )}
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title={recovery ? 'Account recovery' : 'Reset your password'}
      description={
        recovery
          ? 'If you lost your password, reset it by email below. If you lost access to your authenticator app, sign in with one of the recovery codes you saved when enabling two-factor authentication. If you have neither, contact support from the email address on your account.'
          : "Enter your account email and we'll send you a reset link."
      }
      footer={<Link to="/signin" className="font-medium text-ink hover:underline">Back to sign in</Link>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!email}>
          Send reset link
        </Button>
        {recovery && config?.supportEmail && (
          <p className="text-center text-[12.5px] text-muted">
            Support: <a href={`mailto:${config.supportEmail}`} className="text-ink underline-offset-2 hover:underline">{config.supportEmail}</a>
          </p>
        )}
      </form>
    </AuthLayout>
  );
}

function Reset() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const pw = checkPassword(password);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/signin'), 1800);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  if (!token) {
    return (
      <AuthLayout title="Invalid link" description="This reset link is missing its token. Request a new one.">
        <Button variant="primary" className="w-full" asChild>
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthLayout>
    );
  }
  if (done) {
    return (
      <AuthLayout title="Password updated" description="You have been signed out of all devices. Sign in with your new password.">
        <Button variant="primary" className="w-full" asChild>
          <Link to="/signin">Sign in</Link>
        </Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password" description="For your security, this signs you out of all other devices.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="New password" htmlFor="password">
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" />
          <PasswordRules password={password} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!pw.valid}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}

// One request per token, even if the component mounts twice (React StrictMode).
const verifyRequests = new Map<string, Promise<unknown>>();

function Verify() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const { me } = useSession();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'loading' | 'done' | 'error'>(token ? 'loading' : 'error');
  const [message, setMessage] = useState('This verification link is missing its token.');
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    if (!verifyRequests.has(token)) verifyRequests.set(token, api.post('/api/auth/verify-email', { token }));
    verifyRequests
      .get(token)!
      .then(async () => {
        if (cancelled) return;
        setState('done');
        await qc.invalidateQueries({ queryKey: ['me'] });
      })
      .catch((err) => {
        if (cancelled) return;
        setMessage(errorMessage(err));
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [token, qc]);
  if (state === 'loading') {
    return (
      <AuthLayout title="Confirming your email">
        <div className="flex items-center gap-3 text-muted">
          <Spinner /> One moment...
        </div>
      </AuthLayout>
    );
  }
  if (state === 'done') {
    return (
      <AuthLayout title="Email confirmed" description="Thanks. Your email address is verified.">
        <Button variant="primary" className="w-full" asChild>
          <Link to={me ? '/app' : '/signin'}>{me ? 'Continue to Localy' : 'Sign in'}</Link>
        </Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Link not valid" description={message}>
      <Button variant="primary" className="w-full" asChild>
        <Link to={me ? '/app' : '/signin'}>{me ? 'Back to Localy' : 'Sign in'}</Link>
      </Button>
      <p className="mt-3 text-center text-[13px] text-muted">You can request a new verification email from inside the app.</p>
    </AuthLayout>
  );
}

function Invite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { me } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ email: string; role: string; workspaceName: string } | null>(null);
  const [error, setError] = useState<string | null>(token ? null : 'This invitation link is incomplete.');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) return;
    api.get<{ email: string; role: string; workspaceName: string }>(`/api/invitations/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setError(errorMessage(e)));
  }, [token]);
  const accept = async () => {
    setBusy(true);
    try {
      await api.post(`/api/invitations/${encodeURIComponent(token)}/accept`);
      qc.clear();
      navigate('/app', { replace: true });
      window.location.reload();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  if (error) {
    return (
      <AuthLayout title="Invitation unavailable" description={error}>
        <Button variant="primary" className="w-full" asChild>
          <Link to={me ? '/app' : '/signin'}>Continue</Link>
        </Button>
      </AuthLayout>
    );
  }
  if (!info) {
    return (
      <AuthLayout title="Loading invitation">
        <Spinner />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={`Join ${info.workspaceName}`} description={`You've been invited to join as ${info.role === 'admin' ? 'an admin' : 'a member'}. The invitation was sent to ${info.email}.`}>
      {me ? (
        me.user.email.toLowerCase() === info.email.toLowerCase() ? (
          <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={accept}>
            Accept invitation
          </Button>
        ) : (
          <Notice tone="warning">You're signed in as {me.user.email}. Sign out and sign in as {info.email} to accept.</Notice>
        )
      ) : (
        <div className="space-y-2">
          <Button variant="primary" size="lg" className="w-full" asChild>
            <Link to={`/signup?redirect=${encodeURIComponent(`/invite?token=${token}`)}`}>Create an account</Link>
          </Button>
          <Button variant="secondary" size="lg" className="w-full" asChild>
            <Link to={`/signin?redirect=${encodeURIComponent(`/invite?token=${token}`)}`}>Sign in</Link>
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}

export default function Auth({ mode }: { mode: Mode }) {
  switch (mode) {
    case 'signin':
      return <SignIn />;
    case 'signup':
      return <SignUp />;
    case 'forgot':
      return <Forgot />;
    case 'recover':
      return <Forgot recovery />;
    case 'reset':
      return <Reset />;
    case 'verify':
      return <Verify />;
    case 'invite':
      return <Invite />;
  }
}
