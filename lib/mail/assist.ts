import { chat } from '../ai.ts';
import type { User } from '../auth.ts';
import { loadConfig } from '../config.ts';
import type { Mail } from './store.ts';

const renderThread = (thread: Mail[]) =>
  thread
    .map((m) => `From: ${m.from_name || m.from_addr} <${m.from_addr}>\nTo: ${m.to.join(', ')}\nSubject: ${m.subject}\n\n${m.body_text.slice(0, 4000)}`)
    .join('\n\n---\n\n');

export async function summarizeThread(user: User, thread: Mail[]): Promise<string> {
  return chat(
    [
      {
        role: 'system',
        content:
          `You summarise email for ${user.name} (${user.email}). Reply in plain text, no markdown. ` +
          'First give the gist in at most three short lines, each starting with "- ". ' +
          `Then, only if ${user.name} needs to do something, add a line "To do:" followed by the actions, one per line, each line starting with "- ".`,
      },
      { role: 'user', content: renderThread(thread) },
    ],
    { temperature: 0.2, maxTokens: 300 },
  );
}

/** Write an email body. With a thread it writes a reply; without one it writes a new email and a subject. */
export async function draftEmail(user: User, input: { instruction: string; thread?: Mail[] }): Promise<{ subject?: string; body: string }> {
  const { company } = loadConfig();
  const base =
    `You write emails for ${user.name}, who works at ${company.name}. Write in their voice: clear, friendly, brief. ` +
    `Plain text only, no markdown. Never use placeholders in brackets. Sign off with "${user.name.split(' ')[0]}".`;

  if (input.thread?.length) {
    const body = await chat(
      [
        { role: 'system', content: `${base} Output only the body of the reply, nothing else.` },
        {
          role: 'user',
          content: `Conversation so far:\n\n${renderThread(input.thread)}\n\n---\n\nWrite the reply. ${input.instruction ? `What to say: ${input.instruction}` : 'Give a sensible, helpful reply.'}`,
        },
      ],
      { maxTokens: 500 },
    );
    return { body };
  }

  const out = await chat(
    [
      { role: 'system', content: `${base} Output exactly this format: first line "Subject: <subject>", then a blank line, then the email body.` },
      { role: 'user', content: `Write an email. What to say: ${input.instruction}` },
    ],
    { maxTokens: 500 },
  );
  const match = out.match(/^\s*Subject:\s*(.+)\n+([\s\S]*)$/i);
  return match ? { subject: match[1].trim(), body: match[2].trim() } : { body: out };
}
