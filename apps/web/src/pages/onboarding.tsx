import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Mail, Map as MapIcon, MessageSquareReply, PenLine, Search, X } from 'lucide-react';
import { BUSINESS_CATEGORIES, RADIUS_PRESETS_KM, USE_CASES, WEBSITE_FILTER_LABELS, categoryLabel, formatRadius, type LocationValue, type WebsiteFilter } from '@localy/shared';
import { api, errorMessage } from '@/lib/api';
import { useMe, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Button, Field, Input, Notice, Select } from '@/components/ui';
import { Logo } from '@/components/app/logo';
import { LocationSearch } from '@/components/discover/location-search';

const TOTAL = 6;

export default function Onboarding() {
  const me = useMe();
  const { config, signOut } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const s = me.workspace.settings;
  const [step, setStep] = useState(Math.min(Math.max(1, me.user.onboardingStep), TOTAL));
  const [useCase, setUseCase] = useState<string | null>(s.useCase);
  const [business, setBusiness] = useState({ agencyName: s.agencyName ?? me.workspace.name, website: s.website ?? '', industry: s.industry ?? '', location: s.businessLocation ?? '', senderName: s.defaultSenderName ?? me.user.name });
  const [categories, setCategories] = useState<string[]>(s.defaultCategories.length ? s.defaultCategories : []);
  const [locations, setLocations] = useState<LocationValue[]>(s.preferredLocations ?? []);
  const [typedLocation, setTypedLocation] = useState('');
  const [minRating, setMinRating] = useState<number | null>(s.minRating);
  const [maxRating, setMaxRating] = useState<number | null>(s.maxRating);
  const [websiteFilter, setWebsiteFilter] = useState<WebsiteFilter>(s.websiteFilter);
  const [radius, setRadius] = useState(s.defaultRadiusMeters);
  const [busy, setBusy] = useState(false);

  const save = async (nextStep: number, complete = false) => {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { step: nextStep, complete };
      if (step === 2) payload.useCase = useCase;
      if (step === 3) payload.business = business;
      if (step === 5) payload.targets = { categories, locations, minRating, maxRating, websiteFilter, radiusMeters: radius };
      await api.put('/api/me/onboarding', payload);
      if (complete) {
        await qc.invalidateQueries({ queryKey: ['me'] });
        navigate(locations.length ? '/app/discover' : '/app', { replace: true });
      } else {
        setStep(nextStep);
        void qc.invalidateQueries({ queryKey: ['me'] });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = async (provider: 'gmail' | 'microsoft' | 'sandbox') => {
    try {
      await api.put('/api/me/onboarding', { step: 5 });
      const r = await api.post<{ url: string | null }>(`/api/integrations/${provider}/connect`, { redirect: '/onboarding' });
      if (r.url) window.location.href = r.url;
      else {
        toast.success('Development sandbox mailbox connected');
        await qc.invalidateQueries({ queryKey: ['integrations'] });
        setStep(5);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const addTypedLocation = () => {
    const label = typedLocation.trim();
    if (!label) return;
    setLocations((l) => [...l, { label, placeId: null, lat: null, lng: null, source: 'google' as const, resolvedAt: null }].slice(0, 10));
    setTypedLocation('');
  };

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="flex h-16 items-center justify-between px-6">
        <Logo />
        <div className="flex items-center gap-4">
          <span className="text-[12.5px] text-muted">
            Step {step} of {TOTAL}
          </span>
          <button type="button" onClick={() => void signOut()} className="text-[12.5px] text-muted hover:text-ink">
            Sign out
          </button>
        </div>
      </div>
      <div className="h-0.5 bg-line">
        <div className="h-full bg-ink transition-[width] duration-500" style={{ width: `${(step / TOTAL) * 100}%` }} />
      </div>
      <div className="flex flex-1 justify-center px-5 py-12">
        <div key={step} className="page-enter w-full max-w-[560px]">
          {step === 1 && (
            <>
              <h1 className="text-[28px] font-semibold tracking-[-0.035em]">Welcome to Localy</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">Localy helps you find local businesses that don't list a website, and reach out to them with personal, respectful emails from your own inbox.</p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {[
                  { icon: Search, t: 'Discover', d: 'Search any area on the map using the official Google Maps Platform.' },
                  { icon: MapIcon, t: 'Qualify', d: 'See which listings have no website, with transparent signals.' },
                  { icon: PenLine, t: 'Personalize', d: 'Templates fill in each business name, category and location.' },
                  { icon: MessageSquareReply, t: 'Follow up', d: 'Automatic follow-ups stop the moment someone replies.' },
                ].map((x) => (
                  <div key={x.t} className="rounded-lg border border-line bg-panel p-4">
                    <x.icon className="size-4" strokeWidth={1.8} />
                    <div className="mt-3 text-[14px] font-semibold">{x.t}</div>
                    <div className="mt-1 text-[13px] leading-relaxed text-muted">{x.d}</div>
                  </div>
                ))}
              </div>
              <div className="mt-8 flex justify-end">
                <Button variant="primary" size="lg" rightIcon={<ArrowRight />} loading={busy} onClick={() => save(2)}>
                  Get started
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-[26px] font-semibold tracking-[-0.03em]">What are you using Localy for?</h1>
              <p className="mt-2 text-[14.5px] text-muted">This helps us tailor defaults. You can change it later.</p>
              <div className="mt-7 grid gap-2 sm:grid-cols-2" role="radiogroup">
                {USE_CASES.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    role="radio"
                    aria-checked={useCase === u.id}
                    onClick={() => setUseCase(u.id)}
                    className={cn('flex h-12 items-center justify-between rounded-lg border px-4 text-left text-[14px] font-medium transition-colors', useCase === u.id ? 'border-ink bg-panel shadow-sm' : 'border-line bg-panel hover:border-line-strong')}
                  >
                    {u.label}
                    {useCase === u.id && <Check className="size-4" />}
                  </button>
                ))}
              </div>
              <Nav onBack={() => setStep(1)} onNext={() => save(3)} busy={busy} disabled={!useCase} />
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Tell us about your business</h1>
              <p className="mt-2 text-[14.5px] text-muted">Used in your outreach emails and signature.</p>
              <div className="mt-7 grid gap-4 sm:grid-cols-2">
                <Field label="Business or agency name" htmlFor="o-agency" className="sm:col-span-2" hint="Used for {{agencyName}}">
                  <Input id="o-agency" value={business.agencyName} onChange={(e) => setBusiness({ ...business, agencyName: e.target.value })} />
                </Field>
                <Field label="Website" htmlFor="o-web" optional>
                  <Input id="o-web" value={business.website} onChange={(e) => setBusiness({ ...business, website: e.target.value })} placeholder="https://" />
                </Field>
                <Field label="Industry" htmlFor="o-ind" optional>
                  <Input id="o-ind" value={business.industry} onChange={(e) => setBusiness({ ...business, industry: e.target.value })} placeholder="Web design" />
                </Field>
                <Field label="Location" htmlFor="o-loc" optional>
                  <Input id="o-loc" value={business.location} onChange={(e) => setBusiness({ ...business, location: e.target.value })} placeholder="Cape Town" />
                </Field>
                <Field label="Default sender name" htmlFor="o-sender" hint="Used for {{senderName}}">
                  <Input id="o-sender" value={business.senderName} onChange={(e) => setBusiness({ ...business, senderName: e.target.value })} />
                </Field>
              </div>
              <Nav onBack={() => setStep(2)} onNext={() => save(4)} busy={busy} disabled={!business.agencyName.trim() || !business.senderName.trim()} />
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Connect your email</h1>
              <p className="mt-2 text-[14.5px] text-muted">Localy sends from your own mailbox using secure OAuth. We never see or store your email password.</p>
              {!me.user.emailVerified && <Notice tone="warning" className="mt-5">Confirm your email address first. We sent a link to {me.user.email}.</Notice>}
              <div className="mt-7 space-y-2">
                <button type="button" disabled={!config?.features.gmail || !me.user.emailVerified} onClick={() => connect('gmail')} className="flex w-full items-center gap-4 rounded-lg border border-line bg-panel p-4 text-left transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60">
                  <Mail className="size-5" />
                  <span className="flex-1">
                    <span className="block text-[14px] font-medium">Gmail or Google Workspace</span>
                    <span className="block text-[12.5px] text-muted">{config?.features.gmail ? 'Send and detect replies with the Gmail API.' : 'Not configured on this server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET).'}</span>
                  </span>
                  <ArrowRight className="size-4 text-subtle" />
                </button>
                <button type="button" disabled={!config?.features.microsoft || !me.user.emailVerified} onClick={() => connect('microsoft')} className="flex w-full items-center gap-4 rounded-lg border border-line bg-panel p-4 text-left transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60">
                  <Mail className="size-5" />
                  <span className="flex-1">
                    <span className="block text-[14px] font-medium">Microsoft Outlook or Microsoft 365</span>
                    <span className="block text-[12.5px] text-muted">{config?.features.microsoft ? 'Send and detect replies with Microsoft Graph.' : 'Not configured on this server (MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET).'}</span>
                  </span>
                  <ArrowRight className="size-4 text-subtle" />
                </button>
                {config?.features.devSandbox && (
                  <button type="button" onClick={() => connect('sandbox')} className="flex w-full items-center gap-4 rounded-lg border border-dashed border-line-strong bg-panel p-4 text-left transition-colors hover:border-ink">
                    <Mail className="size-5 text-muted" />
                    <span className="flex-1">
                      <span className="block text-[14px] font-medium">Development sandbox</span>
                      <span className="block text-[12.5px] text-muted">Records emails without delivering them. Available in development only.</span>
                    </span>
                    <ArrowRight className="size-4 text-subtle" />
                  </button>
                )}
              </div>
              <Nav onBack={() => setStep(3)} onNext={() => save(5)} busy={busy} nextLabel="Skip for now" nextVariant="secondary" />
            </>
          )}

          {step === 5 && (
            <>
              <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Choose your target businesses</h1>
              <p className="mt-2 text-[14.5px] text-muted">These become your default search settings in Discover.</p>
              <div className="mt-7 space-y-6">
                <Field label="Business categories">
                  <div className="flex flex-wrap gap-1.5">
                    {BUSINESS_CATEGORIES.slice(0, 24).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={categories.includes(c.id)}
                        onClick={() => setCategories((l) => (l.includes(c.id) ? l.filter((x) => x !== c.id) : [...l, c.id].slice(0, 20)))}
                        className={cn('h-8 rounded-md border px-3 text-[13px] transition-colors', categories.includes(c.id) ? 'border-ink bg-ink text-white' : 'border-line bg-panel hover:border-line-strong')}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Preferred locations">
                  {config?.features.places ? (
                    <LocationSearch value={null} placesEnabled compact onChange={(loc) => setLocations((l) => (l.some((x) => x.label === loc.label) ? l : [...l, loc].slice(0, 10)))} />
                  ) : (
                    <div className="flex gap-2">
                      <Input value={typedLocation} onChange={(e) => setTypedLocation(e.target.value)} placeholder="City, suburb or postcode" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTypedLocation())} />
                      <Button onClick={addTypedLocation} disabled={!typedLocation.trim()}>
                        Add
                      </Button>
                    </div>
                  )}
                  {locations.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {locations.map((l) => (
                        <span key={l.label} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-panel pl-2.5 pr-1 text-[12.5px]">
                          {l.label.split(',').slice(0, 2).join(',')}
                          <button type="button" className="flex size-5 items-center justify-center rounded text-subtle hover:bg-hover" aria-label={`Remove ${l.label}`} onClick={() => setLocations((x) => x.filter((y) => y.label !== l.label))}>
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Minimum rating">
                    <Select value={minRating ?? ''} onChange={(e) => setMinRating(e.target.value ? Number(e.target.value) : null)} aria-label="Minimum rating">
                      <option value="">Any</option>
                      {[3, 3.5, 4, 4.5].map((r) => (
                        <option key={r} value={r}>{r}+</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Maximum rating">
                    <Select value={maxRating ?? ''} onChange={(e) => setMaxRating(e.target.value ? Number(e.target.value) : null)} aria-label="Maximum rating">
                      <option value="">Any</option>
                      {[3.5, 4, 4.5].map((r) => (
                        <option key={r} value={r}>{r} or lower</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Website requirement">
                    <Select value={websiteFilter} onChange={(e) => setWebsiteFilter(e.target.value as WebsiteFilter)} aria-label="Website requirement">
                      {(['opportunity', 'not_listed', 'any'] as WebsiteFilter[]).map((w) => (
                        <option key={w} value={w}>{WEBSITE_FILTER_LABELS[w]}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Distance">
                    <Select value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Search radius">
                      {RADIUS_PRESETS_KM.map((k) => (
                        <option key={k} value={k * 1000}>{k} km</option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </div>
              <Nav onBack={() => setStep(4)} onNext={() => save(6)} busy={busy} />
            </>
          )}

          {step === 6 && (
            <>
              <h1 className="text-[28px] font-semibold tracking-[-0.035em]">You're ready</h1>
              <p className="mt-2 text-[15px] text-muted">Here's how your workspace is set up. You can change any of this in Settings.</p>
              <dl className="mt-7 divide-y divide-line rounded-lg border border-line bg-panel text-[13.5px]">
                {[
                  ['Using Localy for', USE_CASES.find((u) => u.id === useCase)?.label ?? 'Not set'],
                  ['Business', business.agencyName],
                  ['Sender name', business.senderName],
                  ['Categories', categories.length ? categories.map(categoryLabel).join(', ') : 'None yet'],
                  ['Locations', locations.length ? locations.map((l) => l.label.split(',')[0]).join(', ') : 'None yet'],
                  ['Website filter', WEBSITE_FILTER_LABELS[websiteFilter]],
                  ['Radius', formatRadius(radius)],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[150px_1fr] gap-3 px-4 py-2.5">
                    <dt className="text-muted">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" leftIcon={<ArrowLeft />} onClick={() => setStep(5)}>
                  Back
                </Button>
                <Button variant="primary" size="lg" rightIcon={<ArrowRight />} loading={busy} onClick={() => save(6, true)}>
                  Start discovering
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Nav({ onBack, onNext, busy, disabled, nextLabel = 'Continue', nextVariant = 'primary' }: { onBack: () => void; onNext: () => void; busy: boolean; disabled?: boolean; nextLabel?: string; nextVariant?: 'primary' | 'secondary' }) {
  return (
    <div className="mt-8 flex items-center justify-between">
      <Button variant="ghost" leftIcon={<ArrowLeft />} onClick={onBack}>
        Back
      </Button>
      <Button variant={nextVariant} size="lg" rightIcon={<ArrowRight />} loading={busy} disabled={disabled} onClick={onNext}>
        {nextLabel}
      </Button>
    </div>
  );
}
