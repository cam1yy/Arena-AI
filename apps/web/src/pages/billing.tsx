import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CreditCard, ExternalLink, FileText } from 'lucide-react';
import type { BillingState, PlanLimits, PlanView, UsageItem } from '@localy/shared';
import { api, errorMessage } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { cn, formatDate, formatMoney, formatNumber } from '@/lib/utils';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Notice, Progress, Skeleton } from '@/components/ui';
import { PageBody, PageHeader } from '@/components/app/page';

interface BillingData {
  billing: BillingState;
  limits: PlanLimits;
  usage: UsageItem[];
  plans: PlanView[];
  paymentMethod: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  invoices: { id: string; number: string | null; amount: number; currency: string; status: string | null; created: string; hostedUrl: string | null; pdfUrl: string | null }[];
  stripeConfigured: boolean;
  hasStripeCustomer: boolean;
  hasStripeSubscription: boolean;
  stripeError: string | null;
}

const STATUS_LABEL: Record<string, string> = { trialing: 'Free trial', active: 'Active', past_due: 'Payment overdue', canceled: 'Canceled', incomplete: 'Incomplete', unpaid: 'Unpaid', expired: 'Trial ended' };

export default function Billing() {
  const can = useCan();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useApi<BillingData>(['billing'], '/api/billing');
  const [changeTo, setChangeTo] = useState<PlanView | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    const status = params.get('checkout');
    const sessionId = params.get('session_id');
    if (status === 'success' && sessionId) {
      api
        .post('/api/billing/sync', { sessionId })
        .then(() => {
          toast.success('Subscription updated. Thank you.');
          void qc.invalidateQueries({ queryKey: ['billing'] });
          void qc.invalidateQueries({ queryKey: ['me'] });
        })
        .catch((e) => toast.error(errorMessage(e)))
        .finally(() => setParams({}, { replace: true }));
    } else if (status === 'canceled') {
      toast.message('Checkout canceled. No changes were made.');
      setParams({}, { replace: true });
    }
  }, [params, setParams, qc]);

  const checkout = useAction((plan: string) => api.post<{ url: string | null; changed?: boolean }>(data?.hasStripeSubscription ? '/api/billing/change-plan' : '/api/billing/checkout', { plan }), {
    invalidate: [['billing'], ['me']],
    onSuccess: (r) => {
      setChangeTo(null);
      if (r.url) window.location.href = r.url;
      else if (r.changed) toast.success('Plan updated');
    },
  });
  const portal = useAction(() => api.post<{ url: string }>('/api/billing/portal'), { onSuccess: (r) => (window.location.href = r.url) });
  const cancel = useAction((resume: boolean) => api.post('/api/billing/cancel', { resume }), {
    success: (_r, resume) => (resume ? 'Subscription resumed' : 'Your subscription will end at the close of the current period'),
    invalidate: [['billing'], ['me']],
    onSuccess: () => setCancelOpen(false),
  });

  if (isLoading) {
    return (
      <PageBody>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-6 h-40" />
        <Skeleton className="mt-6 h-64" />
      </PageBody>
    );
  }
  if (error || !data) return <EmptyState title="Billing could not be loaded" description={error?.message} action={<Button onClick={() => refetch()}>Try again</Button>} />;

  const b = data.billing;
  const current = data.plans.find((p) => p.key === b.planKey);
  const order = data.plans.map((p) => p.key);
  return (
    <>
      <PageHeader
        title="Billing"
        description="Your plan, usage and invoices."
        actions={
          data.hasStripeCustomer && can.manageBilling ? (
            <Button leftIcon={<ExternalLink />} loading={portal.isPending} onClick={() => portal.mutate(undefined)}>
              Manage billing
            </Button>
          ) : undefined
        }
      />
      <PageBody className="space-y-6">
        {!data.stripeConfigured && (
          <Notice tone="warning" title="Payments are not configured">
            Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the plan price IDs (STRIPE_PRICE_ID_PRO, STRIPE_PRICE_ID_AGENCY) on the server to enable upgrades.
          </Notice>
        )}
        {data.stripeError && <Notice tone="warning">{data.stripeError}</Notice>}
        {b.status === 'past_due' && (
          <Notice tone="danger" title="Payment failed" action={can.manageBilling && <Button size="xs" variant="primary" onClick={() => portal.mutate(undefined)}>Update payment method</Button>}>
            We couldn't charge your payment method. Update it to keep your plan active.
          </Notice>
        )}
        {!can.manageBilling && <Notice tone="neutral">Only workspace owners and admins can change the plan.</Notice>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardHeader title="Current plan" />
            <div className="flex flex-wrap items-start justify-between gap-4 p-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[20px] font-semibold tracking-tight">{b.planName}</span>
                  <Badge tone={b.canUseFeatures ? (b.status === 'past_due' ? 'warning' : 'positive') : 'danger'} dot>
                    {b.status === 'trialing' && b.trialEndsAt ? `${Math.max(0, Math.ceil((new Date(b.trialEndsAt).getTime() - Date.now()) / 86_400_000))} days left` : (STATUS_LABEL[b.status] ?? b.status)}
                  </Badge>
                  {b.cancelAtPeriodEnd && <Badge tone="warning">Cancels at period end</Badge>}
                </div>
                <div className="mt-1 text-[13px] text-muted">
                  {b.status === 'trialing' && b.trialEndsAt && `Trial ends ${formatDate(b.trialEndsAt, { month: 'long', day: 'numeric' })}.`}
                  {b.currentPeriodEnd && (b.cancelAtPeriodEnd ? ` Access ends ${formatDate(b.currentPeriodEnd, { month: 'long', day: 'numeric' })}.` : ` Renews ${formatDate(b.currentPeriodEnd, { month: 'long', day: 'numeric' })}.`)}
                  {current?.price && ` ${formatMoney(current.price.amount, current.price.currency)} per ${current.price.interval}.`}
                </div>
                {b.readOnlyReason && <p className="mt-2 text-[13px] text-danger">{b.readOnlyReason}</p>}
              </div>
              {data.hasStripeSubscription && can.manageBilling && (
                b.cancelAtPeriodEnd ? (
                  <Button onClick={() => cancel.mutate(true)} loading={cancel.isPending}>Resume subscription</Button>
                ) : (
                  <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel subscription</Button>
                )
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Payment method" />
            <div className="p-5">
              {data.paymentMethod ? (
                <div className="flex items-center gap-3">
                  <CreditCard className="size-5" />
                  <div className="text-[13.5px]">
                    <div className="font-medium capitalize">{data.paymentMethod.brand} ending {data.paymentMethod.last4}</div>
                    <div className="text-[12.5px] text-muted">Expires {String(data.paymentMethod.expMonth).padStart(2, '0')}/{data.paymentMethod.expYear}</div>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-muted">No payment method on file.</p>
              )}
              {data.hasStripeCustomer && can.manageBilling && (
                <Button size="sm" className="mt-4" onClick={() => portal.mutate(undefined)} loading={portal.isPending}>
                  Update payment method
                </Button>
              )}
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Usage" description="Monthly limits reset on the 1st of each month (UTC)." />
          <div className="grid gap-x-8 gap-y-5 p-5 md:grid-cols-2">
            {data.usage.map((u) => (
              <div key={u.metric}>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-ink-2">{u.label}</span>
                  <span className={cn('tabular', u.exceeded ? 'font-medium text-danger' : u.warning ? 'font-medium text-warning' : u.atCapacity ? 'font-medium text-ink' : 'text-muted')}>
                    {formatNumber(u.used)} / {formatNumber(u.limit)}
                  </span>
                </div>
                <Progress value={u.percent} tone={u.exceeded ? 'danger' : u.warning ? 'warning' : 'default'} className="mt-1.5" />
                {u.warning && <p className="mt-1 text-[12px] text-warning">You're approaching this limit.</p>}
                {u.exceeded && <p className="mt-1 text-[12px] text-danger">{u.monthly ? 'Monthly limit reached. It resets on the 1st, or upgrade to continue now.' : "You're over your plan's limit. Upgrade or remove some to make changes."}</p>}
                {u.atCapacity && <p className="mt-1 text-[12px] text-muted">All included are in use. Upgrade to add more.</p>}
              </div>
            ))}
          </div>
        </Card>

        <div>
          <h2 className="mb-3 text-[14px] font-semibold">Plans</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {data.plans.map((p) => {
              const isCurrent = p.key === b.planKey && b.canUseFeatures;
              const direction = order.indexOf(p.key) > order.indexOf(b.planKey) ? 'Upgrade' : 'Downgrade';
              return (
                <Card key={p.key} className={cn('flex flex-col p-5', isCurrent && 'border-ink')}>
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-semibold">{p.name}</span>
                    {isCurrent && <Badge tone="solid">Current</Badge>}
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted">{p.description}</p>
                  <div className="mt-4 text-[22px] font-semibold tracking-tight">
                    {p.key === 'trial' ? 'Free' : p.price ? (
                      <>
                        {formatMoney(p.price.amount, p.price.currency)}
                        <span className="text-[13px] font-normal text-muted"> / {p.price.interval}</span>
                      </>
                    ) : (
                      <span className="text-[13px] font-normal text-muted">Price not configured</span>
                    )}
                  </div>
                  <ul className="mt-4 flex-1 space-y-1.5 text-[12.5px]">
                    {[
                      `${formatNumber(p.limits.businesses_discovered)} businesses discovered per month`,
                      `${formatNumber(p.limits.emails_sent)} emails per month`,
                      `${formatNumber(p.limits.prospects)} saved prospects`,
                      `${formatNumber(p.limits.active_campaigns)} active campaigns`,
                      `${formatNumber(p.limits.mailboxes)} connected ${p.limits.mailboxes === 1 ? 'mailbox' : 'mailboxes'}`,
                      `${formatNumber(p.limits.seats)} team ${p.limits.seats === 1 ? 'member' : 'members'}`,
                    ].map((f) => (
                      <li key={f} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0" />{f}</li>
                    ))}
                  </ul>
                  {p.key !== 'trial' && !isCurrent && (
                    <Button className="mt-5" variant={direction === 'Upgrade' ? 'primary' : 'secondary'} disabled={!p.purchasable || !can.manageBilling} onClick={() => setChangeTo(p)}>
                      {b.canUseFeatures && b.planKey !== 'trial' ? direction : `Choose ${p.name}`}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] text-muted">Prices are loaded from Stripe. Plan changes are prorated. Taxes may apply at checkout.</p>
        </div>

        <Card>
          <CardHeader title="Invoices" />
          {data.invoices.length === 0 ? (
            <EmptyState compact icon={<FileText />} title="No invoices yet" description="Invoices appear here after your first payment." />
          ) : (
            <ul className="divide-y divide-line">
              {data.invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center gap-4 px-5 py-3 text-[13px]">
                  <span className="w-28 text-muted">{formatDate(inv.created)}</span>
                  <span className="flex-1">{inv.number ?? inv.id}</span>
                  <Badge tone={inv.status === 'paid' ? 'positive' : inv.status === 'open' ? 'warning' : 'neutral'}>{inv.status ?? 'unknown'}</Badge>
                  <span className="tabular w-24 text-right font-medium">{formatMoney(inv.amount, inv.currency)}</span>
                  {inv.hostedUrl && (
                    <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-medium hover:underline">View</a>
                  )}
                  {inv.pdfUrl && (
                    <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-medium hover:underline">PDF</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>
      <ConfirmDialog
        open={Boolean(changeTo)}
        onOpenChange={(o) => !o && setChangeTo(null)}
        title={data.hasStripeSubscription ? `Switch to ${changeTo?.name}?` : `Subscribe to ${changeTo?.name}?`}
        description={data.hasStripeSubscription ? 'Your plan changes immediately and the difference is prorated on your next invoice.' : "You'll be taken to Stripe's secure checkout to enter payment details."}
        confirmLabel={data.hasStripeSubscription ? 'Change plan' : 'Continue to checkout'}
        loading={checkout.isPending}
        onConfirm={() => changeTo && checkout.mutate(changeTo.key)}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel your subscription?"
        description="You keep full access until the end of the current billing period. After that, campaigns pause and discovery is disabled, but your data is kept and you can resubscribe any time."
        confirmLabel="Cancel subscription"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(false)}
      />
    </>
  );
}
