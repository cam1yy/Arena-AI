import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'solid' | 'positive' | 'warning' | 'danger' | 'info' | 'outline';

const tones: Record<Tone, string> = {
  neutral: 'bg-wash text-ink-2 border-transparent',
  solid: 'bg-ink text-white border-transparent',
  positive: 'bg-positive-wash text-positive border-transparent',
  warning: 'bg-warning-wash text-warning border-transparent',
  danger: 'bg-danger-wash text-danger border-transparent',
  info: 'bg-[#eef2ff] text-info border-transparent',
  outline: 'bg-transparent text-ink-2 border-line-strong',
};

export function Badge({ tone = 'neutral', className, dot, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn('inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] border px-1.5 text-[11.5px] font-medium leading-none', tones[tone], className)}
      {...props}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden />}
      {props.children}
    </span>
  );
}
