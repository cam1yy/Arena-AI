import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, type LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-md border border-line bg-panel text-[13.5px] text-ink shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-subtle hover:border-line-strong focus:border-ink focus:outline-none focus:ring-[3px] focus:ring-ink/8 disabled:cursor-not-allowed disabled:bg-wash disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/10';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, leftIcon, rightSlot, invalid, ...props }, ref) {
  if (!leftIcon && !rightSlot) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn(fieldBase, 'h-9 px-3', className)} {...props} />;
  }
  return (
    <div className="relative flex items-center">
      {leftIcon && <span className="pointer-events-none absolute left-3 flex text-subtle [&_svg]:size-4">{leftIcon}</span>}
      <input ref={ref} aria-invalid={invalid || undefined} className={cn(fieldBase, 'h-9 px-3', leftIcon && 'pl-9', rightSlot && 'pr-10', className)} {...props} />
      {rightSlot && <span className="absolute right-1.5 flex items-center">{rightSlot}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, ...props },
  ref,
) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(fieldBase, 'min-h-24 px-3 py-2 leading-relaxed', className)} {...props} />;
});

export function Label({ className, children, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('text-[13px] font-medium text-ink-2', className)} {...props}>
      {children}
    </label>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
  optional,
  action,
}: {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | string[] | null;
  children: ReactNode;
  className?: string;
  optional?: boolean;
  action?: ReactNode;
}) {
  const err = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || action) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <Label htmlFor={htmlFor}>
              {label}
              {optional && <span className="ml-1 font-normal text-subtle">(optional)</span>}
            </Label>
          )}
          {action}
        </div>
      )}
      {children}
      {err ? (
        <p className="text-[12.5px] text-danger" role="alert">
          {err}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
