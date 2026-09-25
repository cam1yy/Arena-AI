import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check, ChevronDown, Filter, Mail, MapPin, MessageSquareReply, PenLine, Search, TrendingUp } from 'lucide-react';
import type { PlanView } from '@localy/shared';
import { useApi } from '@/lib/query';
import { useSession } from '@/lib/session';
import { cn, formatMoney, formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui';
import { Logo } from '@/components/app/logo';

function Nav() {
  const { me } = useSession();
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1160px] items-center gap-8 px-5 md:px-8">
        <Link to="/" aria-label="Localy home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-6 text-[13.5px] text-muted md:flex" aria-label="Sections">
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#features" className="hover:text-ink">Product</a>
          <a href="#pricing" className="hover:text-ink">Pricing</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {me ? (
            <Button variant="primary" asChild>
              <Link to="/app">Open Localy</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link to="/signin">Sign in</Link>
              </Button>
              <Button variant="primary" asChild>
                <Link to="/signup">Get started</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** Static product preview rendered in markup (illustrative, not live data). */
function ProductPreview() {
  const rows = [
    { name: 'Harbour Barbers', cat: 'Barber', rating: '4.7', reviews: 128, dist: '1.2 km', site: false },
    { name: 'Kloof Street Plumbing', cat: 'Plumber', rating: '4.5', reviews: 64, dist: '2.4 km', site: false },
    { name: 'Bo-Kaap Bakery', cat: 'Bakery', rating: '4.8', reviews: 211, dist: '3.1 km', site: false },
    { name: 'Observatory Auto', cat: 'Auto repair', rating: '4.2', reviews: 37, dist: '4.8 km', site: true },
  ];
  return (
    <div className="relative mx-auto mt-16 max-w-[1080px] text-left" aria-label="Illustration of the Localy discovery screen">
      <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-lg">
        <div className="flex h-9 items-center gap-1.5 border-b border-line bg-wash/70 px-3.5">
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="ml-3 text-[11px] text-subtle">localy.app/discover</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_300px]">
          <div className="hidden border-r border-line p-4 md:block">
            <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">Location</div>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-[12.5px]">
              <MapPin className="size-3.5 text-muted" /> Cape Town
            </div>
            <div className="mt-4 text-[11px] font-medium uppercase tracking-wider text-subtle">Radius</div>
            <div className="mt-2 flex gap-1">
              {['5', '10', '25', '50'].map((r) => (
                <span key={r} className={cn('whitespace-nowrap rounded-[5px] px-1.5 py-1 text-[11px]', r === '10' ? 'bg-ink text-white' : 'bg-wash text-muted')}>
                  {r} km
                </span>
              ))}
            </div>
            <div className="mt-4 text-[11px] font-medium uppercase tracking-wider text-subtle">Categories</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {['Barbers', 'Plumbers', 'Bakeries'].map((c) => (
                <span key={c} className="rounded-[5px] border border-line px-1.5 py-0.5 text-[11.5px]">
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-5 flex h-8 items-center justify-center rounded-md bg-ink text-[12px] font-medium text-white">Discover businesses</div>
          </div>
          <div className="relative h-[300px] overflow-hidden bg-[#eef0ec] md:h-auto">
            <svg className="absolute inset-0 size-full" viewBox="0 0 500 380" preserveAspectRatio="xMidYMid slice" aria-hidden>
              <path d="M0 250 C 120 230, 180 300, 300 270 S 450 220, 500 240 L500 380 L0 380Z" fill="#dfe6ea" />
              <path d="M-10 120 L 520 180" stroke="#fff" strokeWidth="9" />
              <path d="M140 -10 L 220 400" stroke="#fff" strokeWidth="7" />
              <path d="M320 -10 L 300 400" stroke="#fff" strokeWidth="5" />
              <path d="M0 60 L 500 40" stroke="#fff" strokeWidth="4" />
              <path d="M60 400 L 420 0" stroke="#fff" strokeWidth="3" />
              <circle cx="250" cy="170" r="120" fill="#0a0a0a" fillOpacity="0.05" stroke="#0a0a0a" strokeOpacity="0.35" strokeDasharray="4 4" />
            </svg>
            {[
              [210, 130, true],
              [300, 200, false],
              [180, 220, false],
              [270, 110, false],
              [330, 150, false],
            ].map(([x, y, active], i) => (
              <span key={i} className={cn('absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white shadow-md', active ? 'z-10 scale-125 bg-ink' : 'bg-ink/80')} style={{ left: `${(Number(x) / 500) * 100}%`, top: `${(Number(y) / 380) * 100}%` }}>
                <span className="size-1.5 rounded-full bg-white" />
              </span>
            ))}
            <span className="absolute left-1/2 top-[45%] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
              <span className="size-3.5 rounded-full border-[3px] border-white bg-[#1d4ed8] shadow-md" />
            </span>
          </div>
          <div className="border-t border-line md:border-l md:border-t-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[12px]">
              <span className="font-medium">38 businesses</span>
              <span className="text-muted">24 without a website listed</span>
            </div>
            {rows.map((r, i) => (
              <div key={r.name} className={cn('border-b border-line px-4 py-3', i === 0 && 'bg-wash/70')}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-medium">{r.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted">
                      {r.cat} &middot; {r.rating} &middot; {r.reviews} reviews &middot; {r.dist}
                    </div>
                  </div>
                  <span className="rounded-[4px] border border-line px-1.5 py-0.5 text-[10.5px] font-medium">Save</span>
                </div>
                <div className={cn('mt-2 inline-flex rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-medium', r.site ? 'bg-wash text-ink-2' : 'bg-warning-wash text-warning')}>{r.site ? 'Website listed' : 'No website listed'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[12px] text-subtle">Illustration. Business names shown are examples.</p>
    </div>
  );
}

const steps = [
  { icon: Search, title: 'Discover', body: 'Pick an area on the map, set a radius, and choose the kinds of businesses you work with. Localy searches Google Maps through the official Places API.' },
  { icon: Filter, title: 'Filter', body: 'See which listings have no website, only a social profile, or a site that does not respond. Narrow by rating, reviews, phone and opening status.' },
  { icon: PenLine, title: 'Personalize', body: 'Write templates with variables like business name, category and location. Preview every email exactly as it will be sent.' },
  { icon: Mail, title: 'Reach out', body: 'Send from your own Gmail or Outlook account. Emails go out in the background with daily limits, sending windows and automatic follow-ups.' },
  { icon: MessageSquareReply, title: 'Track', body: 'Replies land in a focused inbox, stop follow-ups automatically, and update the prospect so nothing slips.' },
  { icon: TrendingUp, title: 'Measure', body: 'Clear analytics on emails sent, delivery, replies and clients won, with every metric defined in plain language.' },
];

const faqs = [
  { q: 'Where does business data come from?', a: 'Localy uses the official Google Maps Platform Places API. It does not scrape Google Maps pages. Business details are fetched live when you view them, and Localy only stores what Google allows, such as place IDs.' },
  { q: 'Does Localy know for sure that a business has no website?', a: 'No, and it never claims to. Localy reports what the listing shows: "No website listed" means the Google Maps listing has no website link. The business may still have one. You can optionally ask Localy to check whether a listed website responds.' },
  { q: 'Where do email addresses come from?', a: 'Google Maps does not provide email addresses. You add contact details you have found yourself, for example from a phone call or the business itself. Localy keeps them private to your workspace.' },
  { q: 'Which email providers are supported?', a: 'Gmail and Google Workspace, and Microsoft Outlook and Microsoft 365. Localy connects with OAuth, never asks for your email password, and stores access tokens encrypted.' },
  { q: 'Will Localy send emails without my approval?', a: 'Never. Nothing is sent until you review it and explicitly start a campaign or confirm a send. Every email includes an unsubscribe link and Localy honours opt-outs across your workspace.' },
  { q: 'Can I cancel anytime?', a: 'Yes. Manage or cancel your subscription from Billing at any time. You can export your data and delete your account from Settings.' },
];

function Pricing() {
  const { data } = useApi<{ plans: PlanView[] }>(['plans'], '/api/plans', { staleTime: 10 * 60_000 });
  const plans = data?.plans ?? [];
  return (
    <section id="pricing" className="border-t border-line py-24">
      <div className="mx-auto max-w-[1160px] px-5 md:px-8">
        <div className="max-w-xl">
          <h2 className="text-[30px] font-semibold tracking-[-0.03em]">Simple pricing</h2>
          <p className="mt-2 text-[15px] text-muted">Start with a free trial. Upgrade when outreach becomes part of your week.</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {(plans.length ? plans : [null, null, null]).map((p, i) => (
            <div key={p?.key ?? i} className={cn('flex flex-col rounded-xl border bg-panel p-6', p?.key === 'pro' ? 'border-ink shadow-md' : 'border-line')}>
              {p ? (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-[15px] font-semibold">{p.name}</h3>
                    {p.key === 'pro' && <span className="rounded-[5px] bg-ink px-1.5 py-0.5 text-[11px] font-medium text-white">Popular</span>}
                  </div>
                  <p className="mt-1.5 min-h-[40px] text-[13px] text-muted">{p.description}</p>
                  <div className="mt-5 h-10">
                    {p.key === 'trial' ? (
                      <span className="text-[28px] font-semibold tracking-tight">Free</span>
                    ) : p.price ? (
                      <span className="text-[28px] font-semibold tracking-tight">
                        {formatMoney(p.price.amount, p.price.currency)}
                        <span className="text-[14px] font-normal text-muted"> / {p.price.interval}</span>
                      </span>
                    ) : (
                      <span className="text-[14px] text-muted">See pricing in the app</span>
                    )}
                  </div>
                  <ul className="mt-5 flex-1 space-y-2 text-[13.5px]">
                    <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0" />{formatNumber(p.limits.businesses_discovered)} businesses discovered per month</li>
                    <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0" />{formatNumber(p.limits.emails_sent)} emails per month</li>
                    <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0" />{formatNumber(p.limits.prospects)} saved prospects</li>
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0" />{f}</li>
                    ))}
                  </ul>
                  <Button variant={p.key === 'pro' ? 'primary' : 'secondary'} className="mt-6 w-full" asChild>
                    <Link to="/signup">{p.key === 'trial' ? 'Start free trial' : `Choose ${p.name}`}</Link>
                  </Button>
                </>
              ) : (
                <div className="h-[380px] skeleton" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="border-t border-line py-24">
      <div className="mx-auto grid max-w-[1160px] gap-10 px-5 md:grid-cols-[320px_1fr] md:px-8">
        <div>
          <h2 className="text-[30px] font-semibold tracking-[-0.03em]">Questions</h2>
          <p className="mt-2 text-[15px] text-muted">Straight answers about data, email and compliance.</p>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {faqs.map((f, i) => (
            <div key={f.q}>
              <button type="button" className="flex w-full items-center justify-between gap-4 py-4 text-left text-[15px] font-medium" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {f.q}
                <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', open === i && 'rotate-180')} />
              </button>
              {open === i && <p className="animate-fade-in pb-5 pr-8 text-[14px] leading-relaxed text-muted">{f.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="min-h-dvh bg-canvas">
      <Nav />
      <main>
        <section className="relative overflow-hidden pb-20 pt-20 md:pt-28">
          <div className="mx-auto max-w-[1160px] px-5 text-center md:px-8">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[12.5px] text-muted shadow-xs">
              <span className="size-1.5 rounded-full bg-positive" /> Built on the official Google Maps Platform APIs
            </div>
            <h1 className="mx-auto mt-6 max-w-[820px] text-[40px] font-semibold leading-[1.05] tracking-[-0.045em] text-ink md:text-[60px]">Find local businesses. Reach the ones that need a website.</h1>
            <p className="mx-auto mt-6 max-w-[600px] text-[16.5px] leading-relaxed text-muted">
              Localy helps web designers and agencies discover local businesses on the map, spot the ones without a website, and run thoughtful, personalized outreach from their own inbox.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button variant="primary" size="lg" asChild rightIcon={<ArrowRight />}>
                <Link to="/signup">
                  Get started <ArrowRight />
                </Link>
              </Button>
              <Button variant="secondary" size="lg" asChild>
                <Link to="/signin">Sign in</Link>
              </Button>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section id="how" className="border-t border-line py-24">
          <div className="mx-auto max-w-[1160px] px-5 md:px-8">
            <div className="max-w-xl">
              <h2 className="text-[30px] font-semibold tracking-[-0.03em]">How Localy works</h2>
              <p className="mt-2 text-[15px] text-muted">One calm workflow from the map to a signed client.</p>
            </div>
            <div id="features" className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
              {steps.map((s, i) => (
                <div key={s.title} className="bg-panel p-7">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-md border border-line bg-canvas">
                      <s.icon className="size-4" strokeWidth={1.8} />
                    </span>
                    <span className="font-mono text-[11px] text-subtle">0{i + 1}</span>
                  </div>
                  <h3 className="mt-5 text-[16px] font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-line py-24">
          <div className="mx-auto grid max-w-[1160px] items-center gap-12 px-5 md:grid-cols-2 md:px-8">
            <div>
              <h2 className="text-[30px] font-semibold tracking-[-0.03em]">Honest signals, not a black box</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">
                Localy never invents an "AI score". Instead, every prospect shows the facts behind it: no website listed, strong rating, high review count, phone available. Sort and filter by whichever signals matter to you.
              </p>
              <ul className="mt-6 space-y-2.5 text-[14px]">
                {['Website status is reported exactly as listed', 'Analytics are computed from real events only', 'Every metric explains how it is calculated'].map((t) => (
                  <li key={t} className="flex items-center gap-2.5">
                    <Check className="size-4" /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-line bg-panel p-6 shadow-sm">
              <div className="text-[13px] font-semibold">Opportunity signals</div>
              <div className="mt-4 space-y-3">
                {[
                  ['No website listed', 'The Google Maps listing does not include a website link.'],
                  ['Strong rating', 'Average rating of 4.3 or higher.'],
                  ['High review count', '50 or more reviews, suggesting an active customer base.'],
                  ['Phone listed', 'You can call to introduce yourself.'],
                ].map(([t, d]) => (
                  <div key={t} className="flex gap-3 rounded-lg border border-line p-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-positive" />
                    <div>
                      <div className="text-[13.5px] font-medium">{t}</div>
                      <div className="text-[12.5px] text-muted">{d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <Pricing />
        <Faq />

        <section className="border-t border-line py-24">
          <div className="mx-auto max-w-[760px] px-5 text-center">
            <h2 className="text-[34px] font-semibold tracking-[-0.035em]">Your next client is already on the map.</h2>
            <p className="mt-3 text-[15px] text-muted">Start your free trial. No credit card required.</p>
            <Button variant="primary" size="lg" className="mt-8" asChild>
              <Link to="/signup">
                Get started <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1160px] flex-col gap-4 px-5 py-10 text-[13px] text-muted md:flex-row md:items-center md:justify-between md:px-8">
          <Logo />
          <div className="flex flex-wrap gap-5">
            <Link to="/privacy" className="hover:text-ink">Privacy</Link>
            <Link to="/terms" className="hover:text-ink">Terms</Link>
            <Link to="/cookies" className="hover:text-ink">Cookies</Link>
            <Link to="/signin" className="hover:text-ink">Sign in</Link>
          </div>
          <span>&copy; {new Date().getFullYear()} Localy</span>
        </div>
      </footer>
    </div>
  );
}
