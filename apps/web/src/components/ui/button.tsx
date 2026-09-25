import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'link';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-2 active:bg-black shadow-xs disabled:bg-ink/40',
  secondary: 'bg-panel text-ink border border-line hover:bg-hover hover:border-line-strong shadow-xs disabled:text-subtle',
  outline: 'bg-transparent text-ink border border-line-strong hover:bg-hover disabled:text-subtle',
  ghost: 'bg-transparent text-ink-2 hover:bg-hover hover:text-ink disabled:text-subtle',
  danger: 'bg-danger text-white hover:bg-[#9a1d13] shadow-xs disabled:bg-danger/40',
  link: 'bg-transparent text-ink underline-offset-4 hover:underline px-0 h-auto',
};

const sizes: Record<Size, string> = {
  xs: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-sm',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-[13.5px] gap-2 rounded-md',
  lg: 'h-11 px-5 text-[14.5px] gap-2 rounded-lg',
  icon: 'h-9 w-9 rounded-md',
  'icon-sm': 'h-7 w-7 rounded-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, asChild, leftIcon, rightIcon, children, disabled, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner className="size-3.5" /> : leftIcon}
          {children}
          {!loading && rightIcon}
        </>
      )}
    </Comp>
  );
});
