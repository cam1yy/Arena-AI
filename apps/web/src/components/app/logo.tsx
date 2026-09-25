import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-6', className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path d="M11 8v16h10" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-canvas" />
      <circle cx="21.5" cy="11" r="2.5" fill="white" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-ink', className)}>
      <LogoMark />
      {!compact && <span className="text-[15.5px] font-semibold tracking-[-0.02em]">Localy</span>}
    </span>
  );
}
