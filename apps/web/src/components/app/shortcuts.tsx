import { Dialog, Kbd } from '@/components/ui';

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['/'], label: 'Open search' },
  { keys: ['Ctrl', 'K'], label: 'Open search' },
  { keys: ['N'], label: 'New prospect' },
  { keys: ['C'], label: 'Create campaign' },
  { keys: ['T'], label: 'Create template' },
  { keys: ['D'], label: 'Discover businesses' },
  { keys: ['G', 'P'], label: 'Go to prospects' },
  { keys: ['G', 'I'], label: 'Go to inbox' },
  { keys: ['Esc'], label: 'Close dialog' },
  { keys: ['?'], label: 'Show shortcuts' },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" description="Shortcuts work anywhere except while typing in a field." size="sm">
      <ul className="divide-y divide-line">
        {SHORTCUTS.map((s) => (
          <li key={s.label + s.keys.join()} className="flex items-center justify-between py-2.5 text-[13.5px]">
            <span className="text-ink-2">{s.label}</span>
            <span className="flex items-center gap-1">
              {s.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
