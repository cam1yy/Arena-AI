import { Link } from 'react-router';
import { useApi } from '@/lib/query';
import { formatDateTime } from '@/lib/utils';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { Logo } from '@/components/app/logo';

/** Development-only outbox showing system emails when SMTP is not configured. */
export default function DevMail() {
  const { data, isLoading, error, refetch } = useApi<{ messages: { id: string; toEmail: string; subject: string; text: string; createdAt: string }[] }>(['dev-mail'], '/api/dev/mail', { refetchInterval: 5000 });
  const linkify = (t: string) => t.split(/(https?:\/\/\S+)/g).map((part, i) => (/^https?:\/\//.test(part) ? <a key={i} href={part.replace(/^https?:\/\/[^/]+/, '')} className="break-all font-medium text-ink underline">{part}</a> : <span key={i}>{part}</span>));
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-16 items-center justify-between border-b border-line px-6">
        <Link to="/"><Logo /></Link>
        <span className="rounded-md bg-warning-wash px-2 py-1 text-[12px] font-medium text-warning">Development outbox</span>
      </header>
      <main className="mx-auto max-w-[760px] px-5 py-10">
        <h1 className="text-[22px] font-semibold tracking-tight">System emails</h1>
        <p className="mt-1 text-[13.5px] text-muted">SMTP is not configured, so verification, password reset and invitation emails are captured here instead of being delivered. This page is unavailable in production.</p>
        <div className="mt-6 space-y-3">
          {isLoading ? <Skeleton className="h-32" /> : error ? (
            <EmptyState title="Outbox unavailable" description={error.message} action={<Button onClick={() => refetch()}>Retry</Button>} />
          ) : !data?.messages.length ? (
            <EmptyState title="No emails yet" description="Emails appear here within a few seconds of being sent by the worker." />
          ) : (
            data.messages.map((m) => (
              <article key={m.id} className="rounded-lg border border-line bg-panel">
                <header className="border-b border-line px-4 py-3">
                  <div className="text-[13.5px] font-semibold">{m.subject}</div>
                  <div className="text-[12px] text-muted">To {m.toEmail} &middot; {formatDateTime(m.createdAt)}</div>
                </header>
                <div className="whitespace-pre-wrap px-4 py-3 text-[13px] leading-relaxed">{linkify(m.text)}</div>
              </article>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
