import { chat } from '@/lib/ai';
import { CATALOG } from '@/lib/catalog';
import { loadConfig } from '@/lib/config';
import { authed } from '@/lib/http';
import { needsYou, schedule } from '@/lib/today';

type Turn = { role: 'user' | 'assistant'; content: string };

/**
 * The assistant. It runs on the local model and knows what is on the user's plate
 * today, plus which apps exist. It answers briefly and may point to one app to open.
 */
export const POST = authed(async ({ req, user }) => {
  const { question, history } = (await req.json()) as { question?: string; history?: Turn[] };
  const q = question?.trim().slice(0, 2000);
  if (!q) throw new Error('Ask something first.');
  const config = loadConfig();
  const apps = CATALOG.filter((a) => config.apps.includes(a.id));
  const todos = needsYou(user).map((t) => `- ${t.title} (${t.sub})`).join('\n') || '- nothing';
  const slots = schedule(user).map((s) => `- ${s.time} ${s.title} (${s.sub})`).join('\n') || '- no meetings';
  const system = [
    `You are the assistant inside databag, the company OS of ${config.company.name}. You run on the company's own computer or server.`,
    `You are talking to ${user.name}. Today is ${new Date().toLocaleDateString('en-GB', { dateStyle: 'full' })}.`,
    `Things waiting for them:\n${todos}`, `Their meetings today:\n${slots}`,
    `Apps they have (id: what it does):\n${apps.map((a) => `${a.id}: ${a.description}`).join('\n')}`,
    'Answer in at most three short sentences of plain text, no markdown. You cannot change anything yourself: tell them where to do it.',
    'If one app is the right place to do what they asked, end with a last line exactly like "OPEN: <app id>". Otherwise do not add that line. Never invent facts about their data beyond what is listed above.',
  ].join('\n\n');
  const past = (history ?? []).slice(-6).map((t) => ({ role: t.role === 'assistant' ? 'assistant' as const : 'user' as const, content: String(t.content).slice(0, 2000) }));
  const out = await chat([{ role: 'system', content: system }, ...past, { role: 'user', content: q }], { maxTokens: 300, temperature: 0.3 });
  const m = /\n?\s*OPEN:\s*([a-z]+)\s*$/i.exec(out);
  const app = m && apps.find((a) => a.id === m[1].toLowerCase());
  return { text: (m ? out.slice(0, m.index) : out).replace(/\*\*/g, '').trim(), open: app ? { id: app.id, name: app.name } : null };
});
