import type { ReactNode } from 'react';
import { Tooltip as T, Tabs as Tb, Switch as Sw, Checkbox as Cb, Popover as Po, Avatar as Av } from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { cn, initials } from '@/lib/utils';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={250}>{children}</T.Provider>;
}

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} collisionPadding={8} className="z-[60] max-w-[280px] rounded-md bg-ink px-2.5 py-1.5 text-[12px] leading-snug text-white shadow-md data-[state=delayed-open]:animate-fade-in">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export function Tabs({ value, onValueChange, items, className }: { value: string; onValueChange: (v: string) => void; items: { value: string; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <Tb.Root value={value} onValueChange={onValueChange}>
      <Tb.List className={cn('flex items-center gap-0.5 overflow-x-auto border-b border-line', className)} aria-label="Views">
        {items.map((it) => (
          <Tb.Trigger
            key={it.value}
            value={it.value}
            className="relative -mb-px flex h-9 shrink-0 items-center gap-1.5 border-b-[1.5px] border-transparent px-2.5 text-[13px] font-medium text-muted transition-colors hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink"
          >
            {it.label}
            {it.count !== undefined && <span className="tabular rounded-[4px] bg-wash px-1 text-[11px] text-muted">{it.count}</span>}
          </Tb.Trigger>
        ))}
      </Tb.List>
    </Tb.Root>
  );
}

export function SegmentedControl<T extends string>({ value, onChange, options, size = 'md', className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div role="radiogroup" className={cn('inline-flex items-center rounded-md border border-line bg-wash p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-[5px] px-2.5 font-medium text-muted transition-all hover:text-ink',
            size === 'sm' ? 'h-6 text-[12px]' : 'h-7 text-[12.5px]',
            value === o.value && 'bg-panel text-ink shadow-sm',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onCheckedChange, disabled, label, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; label?: string; id?: string }) {
  return (
    <Sw.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-line-strong transition-colors data-[state=checked]:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Sw.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
    </Sw.Root>
  );
}

export function Checkbox({ checked, onCheckedChange, label, disabled, className }: { checked: boolean | 'indeterminate'; onCheckedChange: (v: boolean) => void; label?: string; disabled?: boolean; className?: string }) {
  return (
    <Cb.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      disabled={disabled}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line-strong bg-panel shadow-xs transition-colors hover:border-ink data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=indeterminate]:border-ink data-[state=indeterminate]:bg-ink disabled:opacity-50',
        className,
      )}
    >
      <Cb.Indicator className="text-white">{checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}</Cb.Indicator>
    </Cb.Root>
  );
}

export const Popover = Po.Root;
export const PopoverTrigger = Po.Trigger;
export const PopoverAnchor = Po.Anchor;
export function PopoverContent({ children, className, align = 'start', sideOffset = 6 }: { children: ReactNode; className?: string; align?: 'start' | 'center' | 'end'; sideOffset?: number }) {
  return (
    <Po.Portal>
      <Po.Content align={align} sideOffset={sideOffset} collisionPadding={8} className={cn('z-50 rounded-lg border border-line bg-panel p-3 shadow-md focus:outline-none data-[state=open]:animate-scale-in', className)}>
        {children}
      </Po.Content>
    </Po.Portal>
  );
}

export function Avatar({ name, src, size = 28, className }: { name: string | null | undefined; src?: string | null; size?: number; className?: string }) {
  return (
    <Av.Root className={cn('inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-ink text-white', className)} style={{ width: size, height: size }}>
      {src && <Av.Image src={src} alt={name ?? ''} className="size-full object-cover" />}
      <Av.Fallback className="text-[11px] font-semibold" style={{ fontSize: Math.max(10, size * 0.38) }}>
        {initials(name)}
      </Av.Fallback>
    </Av.Root>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-line', className)} role="separator" />;
}

export function Progress({ value, tone = 'default', className }: { value: number; tone?: 'default' | 'warning' | 'danger'; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-wash', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-ink')}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Notice({ tone = 'neutral', title, children, action, className, icon }: { tone?: 'neutral' | 'warning' | 'danger' | 'positive' | 'info'; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode }) {
  const tones = {
    neutral: 'border-line bg-wash/60 text-ink-2',
    warning: 'border-[#f0dfb8] bg-warning-wash text-[#6b4708]',
    danger: 'border-[#f5c6c1] bg-danger-wash text-[#8a1c12]',
    positive: 'border-[#c7e6d4] bg-positive-wash text-[#175c3a]',
    info: 'border-[#d6defc] bg-[#f3f6ff] text-[#1e3a8a]',
  };
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed', tones[tone], className)} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon && <span className="mt-0.5 flex shrink-0 [&_svg]:size-4">{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
