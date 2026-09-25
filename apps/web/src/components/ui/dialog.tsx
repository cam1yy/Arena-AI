import type { ReactNode } from 'react';
import { Dialog as D, AlertDialog as AD } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const width = { sm: 'max-w-[420px]', md: 'max-w-[520px]', lg: 'max-w-[680px]', xl: 'max-w-[880px]' }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[1px] data-[state=open]:animate-fade-in" />
        <D.Content
          className={cn(
            'fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[calc(100vw-24px)] -translate-x-1/2 flex-col rounded-xl border border-line bg-panel shadow-lg focus:outline-none data-[state=open]:animate-scale-in',
            width,
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pb-1 pt-5">
            <div className="min-w-0">
              <D.Title className="text-[15px] font-semibold tracking-tight">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-[13px] leading-relaxed text-muted">{description}</D.Description> : <D.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</D.Description>}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close" className="-mr-1.5 -mt-1">
                <X />
              </Button>
            </D.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3.5 rounded-b-xl">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  loading,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-50 bg-black/25 data-[state=open]:animate-fade-in" />
        <AD.Content className="fixed left-1/2 top-[18vh] z-50 w-[calc(100vw-24px)] max-w-[440px] -translate-x-1/2 rounded-xl border border-line bg-panel p-5 shadow-lg focus:outline-none data-[state=open]:animate-scale-in">
          <AD.Title className="text-[15px] font-semibold tracking-tight">{title}</AD.Title>
          {description ? <AD.Description className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{description}</AD.Description> : <AD.Description className="sr-only">Confirm</AD.Description>}
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-5 flex justify-end gap-2">
            <AD.Cancel asChild>
              <Button variant="secondary">{cancelLabel}</Button>
            </AD.Cancel>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              loading={loading}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}

export function Drawer({ open, onOpenChange, title, description, children, footer, width = 'max-w-[480px]' }: { open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-fade-in" />
        <D.Content className={cn('fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-panel shadow-lg focus:outline-none data-[state=open]:animate-[slide-in_200ms_cubic-bezier(0.2,0.8,0.2,1)]', width)}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <D.Title className="text-[15px] font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-[13px] text-muted">{description}</D.Description> : <D.Description className="sr-only">Panel</D.Description>}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X />
              </Button>
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
