import { useMemo, useState } from 'react';
import { cn, formatDate, formatNumber } from '@/lib/utils';

export interface Series {
  key: string;
  label: string;
  color: string;
}

/** Lightweight, accessible SVG bar/line chart. No external charting dependency. */
export function TimeChart({ points, series, height = 220, bucket = 'day' }: { points: ({ date: string } & Record<string, number | string>)[]; series: Series[]; height?: number; bucket?: 'day' | 'week' }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, ...points.flatMap((p) => series.map((s) => Number(p[s.key]) || 0))), [points, series]);
  const empty = useMemo(() => points.every((p) => series.every((s) => !Number(p[s.key]))), [points, series]);
  // Round the axis up to an even, readable value so the midpoint is a whole number.
  const niceMax = useMemo(() => {
    if (max <= 4) return max <= 2 ? 2 : 4;
    const pow = 10 ** Math.floor(Math.log10(max));
    const n = Math.ceil(max / pow) * pow;
    return n % 2 === 0 ? n : n + pow;
  }, [max]);
  const w = 100 / Math.max(1, points.length);
  const barW = (w * 0.72) / series.length;
  const total = series.map((s) => points.reduce((a, p) => a + (Number(p[s.key]) || 0), 0));
  const hp = hover !== null ? points[hover] : null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px]">
        {series.map((s, i) => (
          <span key={s.key} className="flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
            {s.label}
            <span className="tabular font-medium text-ink">{formatNumber(total[i])}</span>
          </span>
        ))}
        {hp && (
          <span className="ml-auto text-muted">
            {bucket === 'week' ? 'Week of ' : ''}
            {formatDate(hp.date)}: {series.map((s) => `${formatNumber(Number(hp[s.key]) || 0)} ${s.label.toLowerCase()}`).join(', ')}
          </span>
        )}
      </div>
      <div className="relative" style={{ height }}>
        <div className="absolute inset-0" aria-hidden>
          {[niceMax, niceMax / 2, 0].map((v, i) => (
            // Gridlines sit exactly at 100%, 50% and 0% of the plot height so bars align with them.
            <div key={v} className="absolute left-0 right-0 flex -translate-y-1/2 items-center gap-2" style={{ top: `${i * 50}%` }}>
              <span className="tabular w-8 text-right text-[10.5px] leading-none text-subtle">{formatNumber(Math.round(v))}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
          ))}
        </div>
        {empty && (
          <div className="absolute inset-0 left-10 flex items-center justify-center">
            <span className="rounded-md bg-panel px-3 py-1.5 text-[12.5px] text-muted">No activity in this period</span>
          </div>
        )}
        <svg className="absolute bottom-0 left-10 right-0 top-0 h-full" style={{ width: 'calc(100% - 40px)' }} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Chart of ${series.map((s) => s.label).join(' and ')} over time`}>
          {points.map((p, i) =>
            series.map((s, si) => {
              const v = Number(p[s.key]) || 0;
              const h = (v / niceMax) * 100;
              return (
                <rect
                  key={`${i}-${s.key}`}
                  x={i * w + w * 0.14 + si * barW}
                  y={100 - h}
                  width={barW}
                  height={Math.max(h, v > 0 ? 0.8 : 0)}
                  fill={s.color}
                  opacity={hover === null || hover === i ? 1 : 0.35}
                  rx={0.3}
                />
              );
            }),
          )}
          {points.map((_, i) => (
            <rect key={`h-${i}`} x={i * w} y={0} width={w} height={100} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
      </div>
      <div className="ml-10 mt-1.5 flex justify-between text-[10.5px] text-subtle">
        <span>{points[0] && formatDate(points[0].date)}</span>
        <span>{points.length > 2 && formatDate(points[Math.floor(points.length / 2)].date)}</span>
        <span>{points.length > 1 && formatDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}

export function FunnelBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[110px_1fr_48px] items-center gap-3 text-[12.5px]">
          <span className="text-muted">{d.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-wash">
            <span className={cn('block h-full rounded-full bg-ink transition-[width] duration-500')} style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="tabular text-right font-medium">{formatNumber(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}
