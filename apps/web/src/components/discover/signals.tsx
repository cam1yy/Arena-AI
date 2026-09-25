import { Check, Minus } from 'lucide-react';
import { SIGNAL_DEFINITIONS, SIGNAL_KEYS, type Signals } from '@localy/shared';
import { cn } from '@/lib/utils';

export function SignalList({ signals, className }: { signals: Signals; className?: string }) {
  const known = SIGNAL_KEYS.filter((k) => signals[k] !== undefined);
  if (!known.length) return <p className="text-[12.5px] text-muted">No signals available yet.</p>;
  return (
    <ul className={cn('space-y-2', className)}>
      {known.map((k) => (
        <li key={k} className="flex items-start gap-2.5">
          <span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full', signals[k] ? 'bg-ink text-white' : 'bg-wash text-subtle')}>
            {signals[k] ? <Check className="size-2.5" strokeWidth={3.5} /> : <Minus className="size-2.5" strokeWidth={3.5} />}
          </span>
          <span>
            <span className={cn('block text-[13px]', signals[k] ? 'font-medium text-ink' : 'text-muted')}>{SIGNAL_DEFINITIONS[k].label}</span>
            <span className="block text-[12px] leading-snug text-muted">{SIGNAL_DEFINITIONS[k].description}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
