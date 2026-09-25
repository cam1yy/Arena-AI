import { forwardRef } from 'react';
import { Link } from 'react-router';
import { Check, ExternalLink, Globe, Phone, Plus, Star } from 'lucide-react';
import { formatDistance, type DiscoveryResult } from '@localy/shared';
import { cn, formatNumber } from '@/lib/utils';
import { Button, Checkbox, Tooltip } from '@/components/ui';
import { WebsiteStatusBadge } from '@/components/app/status';

export const BusinessCard = forwardRef<
  HTMLDivElement,
  {
    result: DiscoveryResult;
    unit: 'km' | 'mi';
    selected: boolean;
    active: boolean;
    hovered: boolean;
    saving: boolean;
    onToggleSelect: () => void;
    onActivate: () => void;
    onHover: (h: boolean) => void;
    onSave: () => void;
    onDetails: () => void;
  }
>(function BusinessCard({ result: r, unit, selected, active, hovered, saving, onToggleSelect, onActivate, onHover, onSave, onDetails }, ref) {
  const hoursToday = r.weekdayHours?.[(new Date().getDay() + 6) % 7];
  return (
    <div
      ref={ref}
      role="article"
      aria-label={r.name ?? 'Business'}
      aria-current={active || undefined}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onActivate}
      className={cn(
        'group relative cursor-pointer border-b border-line px-4 py-3.5 transition-colors',
        active ? 'bg-wash' : hovered ? 'bg-hover/50' : 'bg-panel',
        active && 'before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-ink',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} label={`Select ${r.name ?? 'business'}`} disabled={Boolean(r.prospectId)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-[13.5px] font-semibold leading-snug text-ink">{r.name ?? 'Unnamed business'}</h3>
            {r.distanceMeters !== null && <span className="tabular shrink-0 text-[11.5px] text-subtle">{formatDistance(r.distanceMeters, unit)}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
            {r.category && <span>{r.category}</span>}
            {r.rating !== null && (
              <>
                {r.category && <span aria-hidden>&middot;</span>}
                <span className="inline-flex items-center gap-0.5 text-ink-2">
                  <Star className="size-3 fill-current" aria-hidden />
                  {r.rating.toFixed(1)}
                </span>
                <span>{formatNumber(r.userRatingCount ?? 0)} reviews</span>
              </>
            )}
          </div>
          {(r.shortAddress || r.address) && <div className="mt-1 truncate text-[12px] text-muted">{r.shortAddress ?? r.address}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <WebsiteStatusBadge status={r.websiteCheck?.status ?? r.websiteStatus} socialOnly={r.socialProfileOnly} />
            {r.phone && (
              <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
                <Phone className="size-3" /> {r.phone}
              </span>
            )}
            {r.openNow !== null && <span className={cn('text-[11.5px]', r.openNow ? 'text-positive' : 'text-muted')}>{r.openNow ? 'Open now' : 'Closed now'}</span>}
            {r.businessStatus && r.businessStatus !== 'OPERATIONAL' && <span className="text-[11.5px] text-danger">{r.businessStatus === 'CLOSED_TEMPORARILY' ? 'Temporarily closed' : 'Permanently closed'}</span>}
          </div>
          {hoursToday && active && <div className="mt-1.5 text-[11.5px] text-muted">{hoursToday}</div>}
          {r.websiteUri && active && (
            <a href={r.websiteUri} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-[12px] text-ink-2 underline-offset-2 hover:underline">
              <Globe className="size-3 shrink-0" />
              <span className="truncate">{r.websiteUri.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
            </a>
          )}
          <div className="mt-2.5 flex items-center gap-1.5">
            {r.prospectId ? (
              <Button size="xs" variant="secondary" asChild onClick={(e) => e.stopPropagation()}>
                <Link to={`/app/prospects/${r.prospectId}`}>
                  <Check /> Saved
                </Link>
              </Button>
            ) : (
              <Button
                size="xs"
                variant="primary"
                loading={saving}
                leftIcon={<Plus />}
                onClick={(e) => {
                  e.stopPropagation();
                  onSave();
                }}
              >
                Add prospect
              </Button>
            )}
            <Button
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onDetails();
              }}
            >
              View details
            </Button>
            {r.googleMapsUri && (
              <Tooltip content="Open in Google Maps">
                <Button size="xs" variant="ghost" asChild onClick={(e) => e.stopPropagation()}>
                  <a href={r.googleMapsUri} target="_blank" rel="noopener noreferrer" aria-label="Open in Google Maps">
                    <ExternalLink /> Maps
                  </a>
                </Button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
