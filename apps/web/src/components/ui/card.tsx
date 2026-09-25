import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-panel shadow-xs', className)} {...props} />;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function Section({ title, description, children, action, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn('grid gap-6 border-b border-line py-8 first:pt-2 last:border-0 md:grid-cols-[240px_1fr]', className)}>
      <div>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
