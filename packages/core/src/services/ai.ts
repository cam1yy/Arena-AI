import { and, desc, eq } from 'drizzle-orm';
import { getConfig } from '@localy/config';
import { notes, prospects } from '@localy/database';
import { AppError, notConfigured } from '../errors';
import { externalFetch } from '../http';
import type { WorkspaceContext } from '../context';
import { assertActiveSubscription } from './usage';
import { senderContext, variablesForProspect } from './personalization';

/*
 * Optional AI assistance behind a provider abstraction. Output is always
 * returned to an editor for the user to review; nothing generated here is
 * ever sent automatically.
 */

export interface AiProvider {
  complete(system: string, prompt: string, workspaceId: string): Promise<string>;
}

const openai: AiProvider = {
  async complete(system, prompt, workspaceId) {
    const cfg = getConfig();
    const res = await externalFetch<{ choices?: { message?: { content?: string } }[] }>({
      service: 'ai',
      operation: 'openai.chat',
      url: `${cfg.OPENAI_BASE_URL.replace(/\/$/, '')}/v1/chat/completions`,
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
      body: { model: cfg.AI_MODEL ?? 'gpt-4o-mini', temperature: 0.6, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] },
      timeoutMs: 45_000,
      retries: 1,
      workspaceId,
    });
    return res.data.choices?.[0]?.message?.content?.trim() ?? '';
  },
};

const anthropic: AiProvider = {
  async complete(system, prompt, workspaceId) {
    const cfg = getConfig();
    const res = await externalFetch<{ content?: { type: string; text?: string }[] }>({
      service: 'ai',
      operation: 'anthropic.messages',
      url: `${cfg.ANTHROPIC_BASE_URL.replace(/\/$/, '')}/v1/messages`,
      method: 'POST',
      headers: { 'x-api-key': cfg.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
      body: { model: cfg.AI_MODEL ?? 'claude-3-5-haiku-latest', max_tokens: 1200, system, messages: [{ role: 'user', content: prompt }] },
      timeoutMs: 45_000,
      retries: 1,
      workspaceId,
    });
    return (res.data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  },
};

function provider(): AiProvider {
  const cfg = getConfig();
  if (!cfg.features.ai) throw notConfigured('AI assistance', ['AI_PROVIDER', 'OPENAI_API_KEY or ANTHROPIC_API_KEY']);
  return cfg.AI_PROVIDER === 'anthropic' ? anthropic : openai;
}

const SYSTEM = `You help a web designer write short, honest, personal cold emails to local businesses that may not have a website.
Rules: plain text only; no emoji; no exaggerated claims; never claim the business definitely has no website (say you could not find one listed); keep emails under 140 words; keep template variables like {{businessName}} exactly as written when present; do not invent facts about the business.`;

export async function runAiTask(
  ctx: WorkspaceContext,
  input: { task: 'draft' | 'rewrite' | 'subjects' | 'summarize_notes' | 'pitch_ideas'; prospectId?: string | null; subject?: string | null; body?: string | null; instructions?: string | null; tone?: string | null },
) {
  await assertActiveSubscription(ctx.db, ctx.workspaceId);
  const ai = provider();
  let context = '';
  if (input.prospectId) {
    const [p] = await ctx.db.select().from(prospects).where(and(eq(prospects.id, input.prospectId), eq(prospects.workspaceId, ctx.workspaceId)));
    if (p) {
      const sender = await senderContext(ctx.db, ctx.workspaceId, { userId: ctx.userId });
      const { vars } = await variablesForProspect(p, sender).catch(() => ({ vars: {} as Record<string, string | null> }));
      context = `Business: ${vars.businessName ?? 'unknown'}\nCategory: ${vars.category ?? 'unknown'}\nLocation: ${vars.location ?? 'unknown'}\nWebsite status: ${p.websiteStatus.replace('_', ' ')}\nSender: ${sender.senderName} (${sender.agencyName})`;
      if (input.task === 'summarize_notes') {
        const rows = await ctx.db.select({ body: notes.body, createdAt: notes.createdAt }).from(notes).where(eq(notes.prospectId, p.id)).orderBy(desc(notes.createdAt)).limit(40);
        if (!rows.length) throw new AppError('BAD_REQUEST', 'This prospect has no notes to summarize yet.');
        context += `\n\nNotes (newest first):\n${rows.map((r) => `- ${r.createdAt.toISOString().slice(0, 10)}: ${r.body}`).join('\n')}`;
      }
    }
  }
  const tone = input.tone ? `Tone: ${input.tone}.` : '';
  const extra = input.instructions ? `Additional instructions: ${input.instructions}` : '';
  let prompt: string;
  switch (input.task) {
    case 'draft':
      prompt = `${context}\n\nWrite a first outreach email offering to build a website. ${tone} ${extra}\nReturn the result as:\nSubject: <subject>\n\n<body>`;
      break;
    case 'rewrite':
      prompt = `Rewrite this outreach email to be clearer and more personal. Keep any {{variables}} unchanged. ${tone} ${extra}\n\nSubject: ${input.subject ?? ''}\n\n${input.body ?? ''}\n\nReturn:\nSubject: <subject>\n\n<body>`;
      break;
    case 'subjects':
      prompt = `${context}\n\nSuggest 5 short, specific subject lines for this email. Keep any {{variables}}. One per line, no numbering.\n\n${input.body ?? ''}`;
      break;
    case 'summarize_notes':
      prompt = `${context}\n\nSummarize these notes in 3 to 5 short bullet points using "-" and list any agreed next step.`;
      break;
    case 'pitch_ideas':
      prompt = `${context}\n\nSuggest 4 concise ideas for what a website for this business could include, tailored to its category. One per line starting with "-".`;
      break;
  }
  const text = await ai.complete(SYSTEM, prompt, ctx.workspaceId);
  if (!text) throw new AppError('EXTERNAL_SERVICE_ERROR', 'The AI provider returned an empty response. Try again.');
  const clean = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
  if (input.task === 'draft' || input.task === 'rewrite') {
    const m = clean.match(/^Subject:\s*(.+)\n+([\s\S]*)$/i);
    return { subject: m ? m[1].trim() : (input.subject ?? ''), body: m ? m[2].trim() : clean, text: clean };
  }
  if (input.task === 'subjects') return { suggestions: clean.split('\n').map((s) => s.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 5), text: clean };
  return { text: clean };
}
