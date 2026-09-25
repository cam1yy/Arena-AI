import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn, formatNumber } from '@/lib/utils';
import { Skeleton, Tooltip } from '@/components/ui';
import { Info } from 'lucide-react';

export function Metric({ label, value, sub, loading, to, hint, className }: { label: string; value: number | string | null | undefined; sub?: ReactNode; loading?: boolean; to?: string; hint?: string; className?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-[12.5px] text-muted">
        {label}
        {hint && (
          <Tooltip content={hint}>
            <span className="inline-flex cursor-help text-subtle" tabIndex={0} aria-label={hint}>
              <Info className="size-3.5" />
            </span>
          </Tooltip>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <div className="tabular mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.03em] text-ink">{typeof value === 'number' ? formatNumber(value) : (value ?? '\u2014')}</div>
      )}
      {sub && !loading && <div className="mt-1.5 text-[12px] text-muted">{sub}</div>}
    </>
  );
  const cls = cn('block bg-panel px-4 py-4 transition-colors', to && 'hover:bg-hover/60', className);
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function MetricGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-xs md:grid-cols-4', className)}>{children}</div>;
}
