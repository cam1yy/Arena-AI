import { useRef, type RefObject } from 'react';
import { Braces } from 'lucide-react';
import { TEMPLATE_VARIABLES, extractVariables, TEMPLATE_VARIABLE_KEYS } from '@localy/shared';
import { cn } from '@/lib/utils';
import { Button, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Tooltip } from '@/components/ui';

function insertAt(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, text: string, onChange: (v: string) => void) {
  if (!el) {
    onChange(value + text);
    return;
  }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
  });
}

export function VariableMenu({ targetRef, value, onChange, label = 'Insert variable' }: { targetRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="xs" variant="ghost" leftIcon={<Braces />}>
          {label}
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="w-[280px]">
        <MenuLabel>Personalization</MenuLabel>
        {TEMPLATE_VARIABLES.map((v) => (
          <MenuItem key={v.key} onSelect={() => insertAt(targetRef.current, value, `{{${v.key}}}`, onChange)}>
            <span className="flex w-full items-center justify-between gap-3">
              <span>{v.label}</span>
              <code className="font-mono text-[11px] text-subtle">{`{{${v.key}}}`}</code>
            </span>
          </MenuItem>
        ))}
        <div className="border-t border-line px-2 py-2 text-[11.5px] leading-snug text-muted">Add a fallback with a pipe, for example {'{{firstName|there}}'}.</div>
      </MenuContent>
    </Menu>
  );
}

/** Highlights unknown variables so typos are caught before sending. */
export function VariableWarnings({ texts }: { texts: string[] }) {
  const unknown = [...new Set(texts.flatMap(extractVariables))].filter((v) => !(TEMPLATE_VARIABLE_KEYS as readonly string[]).includes(v));
  if (!unknown.length) return null;
  return (
    <p className="text-[12px] text-danger" role="alert">
      Unknown {unknown.length === 1 ? 'variable' : 'variables'}: {unknown.map((u) => `{{${u}}}`).join(', ')}. These will not be replaced.
    </p>
  );
}

export function EmailFields({
  subject,
  body,
  onSubject,
  onBody,
  bodyRows = 14,
  className,
  subjectPlaceholder = 'A website idea for {{businessName}}',
}: {
  subject: string;
  body: string;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
  bodyRows?: number;
  className?: string;
  subjectPlaceholder?: string;
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-panel shadow-xs focus-within:border-ink focus-within:ring-[3px] focus-within:ring-ink/8', className)}>
      <div className="flex items-center gap-2 border-b border-line px-3.5">
        <label htmlFor="email-subject" className="text-[12.5px] text-muted">
          Subject
        </label>
        <input ref={subjectRef} id="email-subject" value={subject} onChange={(e) => onSubject(e.target.value)} placeholder={subjectPlaceholder} className="h-10 min-w-0 flex-1 bg-transparent text-[13.5px] font-medium outline-none placeholder:font-normal placeholder:text-subtle" maxLength={300} />
        <Tooltip content="Insert a variable into the subject">
          <span>
            <VariableMenu targetRef={subjectRef} value={subject} onChange={onSubject} label="" />
          </span>
        </Tooltip>
      </div>
      <div className="relative">
        <textarea ref={bodyRef} id="email-body" aria-label="Message" value={body} onChange={(e) => onBody(e.target.value)} rows={bodyRows} className="block w-full resize-y bg-transparent px-3.5 py-3 font-sans text-[13.5px] leading-[1.65] outline-none placeholder:text-subtle" placeholder="Write your message..." maxLength={20000} />
        <div className="flex items-center justify-between border-t border-line bg-canvas/60 px-2 py-1">
          <span className="px-1.5 text-[11.5px] text-subtle">{body.length.toLocaleString()} characters</span>
          <VariableMenu targetRef={bodyRef} value={body} onChange={onBody} />
        </div>
      </div>
    </div>
  );
}

export function EmailPreview({ subject, body, from, to, missing, footerNote, loading }: { subject: string; body: string; from?: string | null; to?: string | null; missing?: string[]; footerNote?: string | null; loading?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-xs">
      <div className="space-y-1 border-b border-line px-4 py-3 text-[12.5px]">
        {from && (
          <div className="flex gap-2">
            <span className="w-12 text-muted">From</span>
            <span className="truncate text-ink-2">{from}</span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="w-12 text-muted">To</span>
          <span className={cn('truncate', to ? 'text-ink-2' : 'text-subtle')}>{to ?? 'No email address yet'}</span>
        </div>
        <div className="flex gap-2">
          <span className="w-12 text-muted">Subject</span>
          <span className="truncate font-medium text-ink">{subject || <span className="font-normal text-subtle">No subject</span>}</span>
        </div>
      </div>
      <div className={cn('whitespace-pre-wrap break-words px-4 py-4 text-[13.5px] leading-[1.65] text-ink', loading && 'opacity-50')}>
        {body ? (
          (() => {
            const [main, ...rest] = body.split('\n--\n');
            return (
              <>
                {main}
                {rest.length > 0 && <span className="mt-4 block break-all border-t border-line pt-3 text-[11.5px] leading-relaxed text-muted">{rest.join('\n--\n')}</span>}
              </>
            );
          })()
        ) : (
          <span className="text-subtle">Your message preview will appear here.</span>
        )}
      </div>
      {(missing?.length || footerNote) && (
        <div className="space-y-1 border-t border-line bg-canvas/60 px-4 py-2.5 text-[11.5px]">
          {missing && missing.length > 0 && <div className="text-warning">No value for: {missing.map((m) => `{{${m}}}`).join(', ')}. Add a fallback or fill in the prospect's details.</div>}
          {footerNote && <div className="text-muted">{footerNote}</div>}
        </div>
      )}
    </div>
  );
}
