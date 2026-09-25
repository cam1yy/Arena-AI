import type { ReactNode } from 'react';
import { DropdownMenu as DM } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export const MenuSub = DM.Sub;

export function MenuContent({ children, align = 'end', className, sideOffset = 6 }: { children: ReactNode; align?: 'start' | 'center' | 'end'; className?: string; sideOffset?: number }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn('z-50 min-w-[200px] overflow-hidden rounded-lg border border-line bg-panel p-1 shadow-md data-[state=open]:animate-scale-in', className)}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

const itemCls =
  'relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] text-ink-2 outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-hover data-[highlighted]:text-ink data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted';

export function MenuItem({ children, onSelect, destructive, disabled, icon, shortcut }: { children: ReactNode; onSelect?: () => void; destructive?: boolean; disabled?: boolean; icon?: ReactNode; shortcut?: string }) {
  return (
    <DM.Item disabled={disabled} onSelect={onSelect} className={cn(itemCls, destructive && 'text-danger data-[highlighted]:text-danger [&_svg]:text-danger')}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="ml-4 font-mono text-[11px] text-subtle">{shortcut}</span>}
    </DM.Item>
  );
}

export function MenuCheckboxItem({ children, checked, onCheckedChange }: { children: ReactNode; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <DM.CheckboxItem checked={checked} onCheckedChange={onCheckedChange} onSelect={(e) => e.preventDefault()} className={cn(itemCls, 'pl-7')}>
      <DM.ItemIndicator className="absolute left-2 flex">
        <Check className="!text-ink" />
      </DM.ItemIndicator>
      {children}
    </DM.CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">{children}</DM.Label>;
}

export function MenuSeparator() {
  return <DM.Separator className="-mx-1 my-1 h-px bg-line" />;
}

export function MenuSubTrigger({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <DM.SubTrigger className={cn(itemCls, 'data-[state=open]:bg-hover')}>
      {icon}
      <span className="flex-1">{children}</span>
      <span className="text-subtle">&rsaquo;</span>
    </DM.SubTrigger>
  );
}

export function MenuSubContent({ children }: { children: ReactNode }) {
  return (
    <DM.Portal>
      <DM.SubContent sideOffset={4} className="z-50 max-h-[320px] min-w-[180px] overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-md data-[state=open]:animate-scale-in">
        {children}
      </DM.SubContent>
    </DM.Portal>
  );
}
