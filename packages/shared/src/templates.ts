/**
 * Template personalization shared by the browser (live preview) and the
 * server (sending). Syntax: {{variable}} or {{variable|fallback text}}.
 */
export interface TemplateVariableDefinition {
  key: TemplateVariableKey;
  label: string;
  description: string;
  /** Used when no value is available and the template does not define its own fallback. */
  defaultFallback?: string;
  example: string;
}

export const TEMPLATE_VARIABLE_KEYS = [
  'firstName',
  'lastName',
  'businessName',
  'category',
  'location',
  'senderName',
  'agencyName',
] as const;
export type TemplateVariableKey = (typeof TEMPLATE_VARIABLE_KEYS)[number];
export type TemplateVariables = Partial<Record<TemplateVariableKey, string | null | undefined>>;

export const TEMPLATE_VARIABLES: TemplateVariableDefinition[] = [
  {
    key: 'firstName',
    label: 'First name',
    description: 'Contact first name, if you have added one to the prospect.',
    defaultFallback: 'there',
    example: 'Sam',
  },
  {
    key: 'lastName',
    label: 'Last name',
    description: 'Contact last name, if you have added one to the prospect.',
    defaultFallback: '',
    example: 'Jacobs',
  },
  {
    key: 'businessName',
    label: 'Business name',
    description: 'The name you use for the business. Falls back to the live Google Maps listing name.',
    example: 'Harbour Barbers',
  },
  {
    key: 'category',
    label: 'Category',
    description: 'Business category, for example "barber" or "plumber".',
    defaultFallback: 'local business',
    example: 'barber',
  },
  {
    key: 'location',
    label: 'Location',
    description: 'Suburb or city of the business.',
    defaultFallback: 'your area',
    example: 'Cape Town',
  },
  {
    key: 'senderName',
    label: 'Sender name',
    description: 'Your name as it appears in outreach, from Settings.',
    example: 'Alex Morgan',
  },
  {
    key: 'agencyName',
    label: 'Agency name',
    description: 'Your business or agency name, from Settings.',
    example: 'Morgan Studio',
  },
];

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

export interface RenderResult {
  output: string;
  /** Variables that had no value and no fallback. Their placeholders are replaced with an empty string. */
  missing: TemplateVariableKey[];
  /** Variable names that are not recognized. Left untouched in the output. */
  unknown: string[];
  used: TemplateVariableKey[];
}

const isKnown = (name: string): name is TemplateVariableKey =>
  (TEMPLATE_VARIABLE_KEYS as readonly string[]).includes(name);

export function renderTemplate(template: string, vars: TemplateVariables, opts: { keepMissing?: boolean } = {}): RenderResult {
  const missing = new Set<TemplateVariableKey>();
  const unknown = new Set<string>();
  const used = new Set<TemplateVariableKey>();
  const output = template.replace(VARIABLE_PATTERN, (match, rawName: string, inlineFallback?: string) => {
    if (!isKnown(rawName)) {
      unknown.add(rawName);
      return match;
    }
    used.add(rawName);
    const value = vars[rawName];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    if (opts.keepMissing) return match;
    if (inlineFallback !== undefined) return inlineFallback;
    const def = TEMPLATE_VARIABLES.find((v) => v.key === rawName);
    if (def?.defaultFallback !== undefined) return def.defaultFallback;
    missing.add(rawName);
    return '';
  });
  return { output, missing: [...missing], unknown: [...unknown], used: [...used] };
}

export function extractVariables(template: string): string[] {
  const names = new Set<string>();
  for (const m of template.matchAll(VARIABLE_PATTERN)) names.add(m[1]);
  return [...names];
}

export interface RenderedEmail {
  subject: string;
  body: string;
  missing: TemplateVariableKey[];
  unknown: string[];
}

export function renderEmail(subject: string, body: string, vars: TemplateVariables, opts: { keepMissing?: boolean } = {}): RenderedEmail {
  const s = renderTemplate(subject, vars, opts);
  const b = renderTemplate(body, vars, opts);
  return {
    subject: s.output.replace(/\s+/g, ' ').trim(),
    body: b.output,
    missing: [...new Set([...s.missing, ...b.missing])],
    unknown: [...new Set([...s.unknown, ...b.unknown])],
  };
}

export const EXAMPLE_VARIABLES: TemplateVariables = Object.fromEntries(
  TEMPLATE_VARIABLES.map((v) => [v.key, v.example]),
) as TemplateVariables;

export const DEFAULT_TEMPLATE = {
  name: 'Website idea',
  subject: 'A website idea for {{businessName}}',
  body: `Hi {{firstName}},

I came across {{businessName}} while looking at businesses in {{location}}.

I noticed that I couldn't find a website listed for your business, so I wanted to reach out.

I build modern websites for local businesses and would be happy to put together a quick example of what a site for {{businessName}} could look like.

If you're interested, I can send over a preview.

Best,
{{senderName}}`,
};

export const DEFAULT_FOLLOW_UP_TEMPLATES = [
  {
    name: 'Gentle follow-up',
    subject: 'Re: A website idea for {{businessName}}',
    delayDays: 3,
    body: `Hi {{firstName}},

Just following up on my note from earlier this week. I'd still be glad to put together a free example website for {{businessName}}, with no obligation.

Would that be useful?

Best,
{{senderName}}`,
  },
  {
    name: 'Final follow-up',
    subject: 'Re: A website idea for {{businessName}}',
    delayDays: 4,
    body: `Hi {{firstName}},

I don't want to fill up your inbox, so this will be my last message. If a website for {{businessName}} is ever something you'd like to explore, just reply to this email and I'll send over some ideas.

All the best,
{{senderName}}`,
  },
];

/** Converts plain-text email content into minimal, safe HTML. */
export function textToHtml(text: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const linkify = (s: string) =>
    s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (url) => `<a href="${url}">${url}</a>`);
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 14px 0">${linkify(escape(para)).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
