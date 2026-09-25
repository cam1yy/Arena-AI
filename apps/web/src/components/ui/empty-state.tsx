import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function EmptyState({ icon, title, description, action, className, compact }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-6 py-10' : 'px-6 py-20', className)}>
      {icon && <div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-line bg-panel text-muted shadow-xs [&_svg]:size-[18px]">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
