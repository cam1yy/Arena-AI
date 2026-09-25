import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PageHeader({ title, description, actions, breadcrumbs, className, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: { label: string; to?: string }[]; className?: string; children?: ReactNode }) {
  return (
    <header className={cn('border-b border-line bg-canvas/80 px-5 pb-4 pt-5 backdrop-blur-sm md:px-8 md:pt-7', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-[12.5px] text-muted">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 text-subtle" aria-hidden />}
              {b.to ? (
                <Link to={b.to} className="hover:text-ink">
                  {b.label}
                </Link>
              ) : (
                <span className="text-ink-2">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-[21px] font-semibold tracking-[-0.022em] text-ink">{title}</h1>
          {description && <p className="mt-1 text-[13.5px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function PageBody({ children, className, width = 'default' }: { children: ReactNode; className?: string; width?: 'default' | 'narrow' | 'wide' | 'full' }) {
  const w = { default: 'max-w-[1200px]', narrow: 'max-w-[860px]', wide: 'max-w-[1440px]', full: 'max-w-none' }[width];
  return <div className={cn('page-enter mx-auto w-full px-5 py-6 md:px-8', w, className)}>{children}</div>;
}
