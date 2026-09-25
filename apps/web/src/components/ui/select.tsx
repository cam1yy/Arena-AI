import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Native select styled to match the design system. Native keeps it fully accessible and mobile friendly. */
export const Select = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { invalid?: boolean; size?: 'sm' | 'md' }>(
  function Select({ className, children, invalid, size = 'md', ...props }, ref) {
    return (
      <div className={cn('relative', className)}>
        <select
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(
            'w-full appearance-none rounded-md border border-line bg-panel pl-3 pr-8 text-[13.5px] text-ink shadow-xs transition-[border-color,box-shadow] hover:border-line-strong focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink/8 disabled:bg-wash disabled:text-muted',
            size === 'sm' ? 'h-8 text-[13px]' : 'h-9',
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
      </div>
    );
  },
);
