import crypto from 'node:crypto';
import { type AgentMessage, type ToolCall, type ToolSpec, chatWithTools } from '../ai.ts';
import { type User, listUsers } from '../auth.ts';
import { CATALOG } from '../catalog.ts';
import { loadConfig } from '../config.ts';
import { get, run } from '../db.ts';
import { emit } from '../events.ts';
import { decideActivity, logActivity } from './activity.ts';
import { type Profile, RULES, loadProfile } from './profile.ts';
import { TOOLS, type Risk, type Tool, riskOf, toolByName } from './tools.ts';

/**
 * The agent: one conversation per open panel. It reads the request, uses tools in
 * any app, and stops to ask the person before actions that need their OK.
 * Conversations live in memory for an hour; nothing is sent anywhere but the local model.
 */
export type Done = { tool: string; app: string; summary: string; ok: boolean; error?: string; link?: string };
export type Pending = { id: string; tool: string; app: string; risk: Risk; summary: string; preview: { label: string; value: string; editable?: boolean; key?: string }[] };
export type Turn = { conversation: string; reply: string; done: Done[]; pending: Pending | null; incomplete?: boolean; declined?: boolean };
type Conversation = {
  id: string; userId: string; app: string; messages: AgentMessage[]; updated: number;
  /** Set when the conversation is with an agent built in the Agents app. */
  agentId?: string;
  waiting?: { call: ToolCall; args: Record<string, unknown>; queue: ToolCall[]; pending: Pending };
};

const MAX_STEPS = 8;
// Conversations are kept in the database, so an approval still works when another server
// answers it (the cloud) or after a restart. They are removed after an hour of quiet.
const loadConversation = (id: string): Conversation | undefined => { const r = get<{ data: string }>('SELECT data FROM agent_conversations WHERE id = ?', id); return r ? JSON.parse(r.data) : undefined; };
function saveConversation(c: Conversation): void {
  c.updated = Date.now();
  run('INSERT INTO agent_conversations (id, user_id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', c.id, c.userId, JSON.stringify(c), c.updated);
}
async function saved(c: Conversation, turn: Promise<Turn>): Promise<Turn> {
  try { return await turn; } finally { saveConversation(c); }
}
const NEEDS = { contacts: ['contacts', 'crm'], crm: ['crm'], overview: [] as string[] } as Record<string, string[]>;

/** Which actions wait for the person's OK: 'send' (default) = anything that reaches other people; 'all' = every change. */
export const confirmPolicy = () => loadConfig().agent?.confirm ?? 'send';
const needsOk = (risk: Risk) => risk !== 'read' && (confirmPolicy() === 'all' || risk === 'send');

function available(): Tool[] {
  const apps = loadConfig().apps;
  return TOOLS.filter((t) => t.app === 'overview' || (NEEDS[t.app] ?? [t.app]).some((a) => apps.includes(a)));
}
const spec = (t: Tool): ToolSpec => ({ type: 'function', function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.params, required: t.required ?? [] } } });

/**
 * The instructions never change, so the model can keep them (and the tool list) cached:
 * a request then costs about half a second instead of three. Everything that varies
 * (who, when, which app) travels in a short context line on each message instead.
 */
const SYSTEM = [
  'You are the databag agent. You do work for the signed-in user inside their company\'s apps by calling tools. You run on the company\'s own computer.',
  'Each user message starts with a line in square brackets giving the user, the company, the current date and time with the dates of the coming days, and which app they are in. Use it to work out dates; write times as YYYY-MM-DD HH:MM.',
  RULES,
  '- Prefer the tools of the app the user is in, but use any app\'s tools when the request needs them.',
  '- When finished, reply in one to three short plain sentences saying what you did or found. No markdown. Never claim something happened unless a tool result says so.',
].join('\n');

/** The tools, instructions and model for a conversation: the built-in agent, or one built in Agents. */
type Setup = { system: string; tools: Tool[]; profile?: Profile };
async function setupFor(c: Conversation): Promise<Setup> {
  if (!c.agentId) return { system: SYSTEM, tools: available() };
  const profile = await loadProfile(c.agentId);
  return { system: profile.system, tools: profile.tools, profile };
}
const find = (s: Setup, name: string) => s.tools.find((t) => t.name === name) ?? (s.profile ? undefined : toolByName(name));

function context(u: User, app: string): string {
  const now = new Date();
  const days = Array.from({ length: 8 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() + i); return `${i === 0 ? 'today' : i === 1 ? 'tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'long' })} ${d.toISOString().slice(0, 10)}`; }).join(', ');
  const here = CATALOG.find((a) => a.id === app);
  return `[User: ${u.name} <${u.email}>, first name ${u.name.split(' ')[0]}. Company: ${loadConfig().company.name}. Now: ${now.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Dates: ${days}. App: ${here ? here.name : 'overview'}.]`;
}

/** Load the model with the instructions and tools at start-up, so the first request is quick too. */
export async function warmAgent(): Promise<void> {
  try { await chatWithTools([{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Ready?' }], { tools: available().map(spec), maxTokens: 1 }); } catch { /* the model may not be running yet */ }
}

const who = (s: Setup) => ({ agentId: s.profile?.id ?? null, agentName: s.profile?.name ?? 'Assistant' });

async function runTool(u: User, s: Setup, c: Conversation, call: ToolCall, args: Record<string, unknown>, done: Done[]): Promise<string> {
  const tool = find(s, call.function.name);
  if (!tool) return JSON.stringify({ error: `There is no tool called ${call.function.name}.` });
  let summary = tool.name;
  const risk = riskOf(tool, args);
  try {
    summary = tool.summary(args, u);
    const result = await tool.run(u, args);
    const link = tool.link?.(args, result);
    if (risk !== 'read') {
      done.push({ tool: tool.name, app: tool.app, summary, ok: true, link });
      emit({ type: 'agent.action', app: tool.app === 'overview' ? 'settings' : tool.app, userId: u.id, summary: `${who(s).agentName}: ${summary}`, payload: { tool: tool.name } });
    }
    logActivity({ ...who(s), userId: u.id, conversation: c.id, tool: tool.name, app: tool.app, risk, summary, status: 'done', link });
    return JSON.stringify(result ?? { ok: true }).slice(0, 6000);
  } catch (err) {
    const error = (err as Error).message;
    if (risk !== 'read') done.push({ tool: tool.name, app: tool.app, summary, ok: false, error });
    logActivity({ ...who(s), userId: u.id, conversation: c.id, tool: tool.name, app: tool.app, risk, summary, status: 'failed', detail: error });
    return JSON.stringify({ error });
  }
}
const parseArgs = (call: ToolCall): Record<string, unknown> => { try { return JSON.parse(call.function.arguments || '{}') ?? {}; } catch { return {}; } };

/** Work through tool calls until the model answers, or until an action needs the person's OK. */
async function advance(u: User, c: Conversation, queue: ToolCall[], done: Done[]): Promise<Turn> {
  const s = await setupFor(c);
  const tools = s.tools.map(spec);
  if (c.messages[0]?.role === 'system') c.messages[0] = { role: 'system', content: s.system };
  for (let step = 0; step < (s.profile ? 14 : MAX_STEPS); step++) {
    while (queue.length) {
      let call = queue.shift()!;
      // An agent reaching for a databag tool it was not given: turn it into a request for access.
      if (s.profile && !find(s, call.function.name) && toolByName(call.function.name) && find(s, 'request_access'))
        call = { ...call, function: { name: 'request_access', arguments: JSON.stringify({ tool: call.function.name, reason: 'It tried to use this tool, which it has not been given.' }) } };
      const args = parseArgs(call);
      const tool = find(s, call.function.name);
      if (tool && needsOk(riskOf(tool, args))) {
        let pending: Pending;
        try {
          pending = { id: crypto.randomUUID(), tool: tool.name, app: tool.app, risk: riskOf(tool, args), summary: tool.summary(args, u), preview: tool.preview?.(args, u) ?? [] };
        } catch (err) {
          // The request itself is not possible (for example an unknown person): tell the model, do not ask the user.
          c.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: (err as Error).message }) });
          continue;
        }
        c.waiting = { call, args, queue, pending };
        logActivity({ ...who(s), userId: u.id, conversation: c.id, tool: tool.name, app: tool.app, risk: pending.risk, summary: pending.summary, status: 'waiting', pendingId: pending.id });
        return { conversation: c.id, reply: '', done, pending };
      }
      c.messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(u, s, c, call, args, done) });
    }
    const out = await chatWithTools(c.messages, { tools, ai: s.profile?.ai, maxTokens: s.profile ? 2000 : undefined });
    c.messages.push({ role: 'assistant', content: out.content || null, ...(out.toolCalls.length ? { tool_calls: out.toolCalls } : {}) });
    if (!out.toolCalls.length) return { conversation: c.id, reply: out.content || (done.length ? 'Done.' : 'I could not work that out. Try saying it another way.'), done, pending: null };
    queue = [...out.toolCalls];
  }
  return { conversation: c.id, reply: 'That took more steps than I am allowed. Here is how far I got.', done, pending: null, incomplete: true };
}

function load(u: User, id: string | undefined, app: string, agentId?: string): Conversation {
  const now = Date.now();
  // Quiet conversations go after an hour; one waiting for an approval (a factory task) is kept a week.
  run(`DELETE FROM agent_conversations WHERE (updated_at < ? AND data NOT LIKE '%"waiting":%') OR updated_at < ?`, now - 3_600_000, now - 7 * 864e5);
  const existing = id ? loadConversation(id) : undefined;
  if (existing && existing.userId === u.id && existing.agentId === agentId) return existing;
  return { id: crypto.randomUUID(), userId: u.id, app, messages: [], updated: now, ...(agentId ? { agentId } : {}) };
}

export async function ask(u: User, { conversation, message, app, agent }: { conversation?: string; message: string; app?: string; agent?: string }): Promise<Turn> {
  const text = message?.trim().slice(0, 12000);
  if (!text) throw new Error('Say what you would like done.');
  const c = load(u, conversation, app || 'overview', agent || undefined);
  if (c.waiting) {
    // A new message while an action waits means "no" to that action.
    c.messages.push({ role: 'tool', tool_call_id: c.waiting.call.id, content: JSON.stringify({ error: 'The user did not approve this action.' }) });
    for (const q of c.waiting.queue) c.messages.push({ role: 'tool', tool_call_id: q.id, content: JSON.stringify({ error: 'Skipped.' }) });
    c.waiting = undefined;
  }
  c.app = app || c.app;
  // Keep the last part of the conversation, starting at a user message so tool calls and results stay paired.
  let past = c.messages.filter((m) => m.role !== 'system');
  if (past.length > 40) { past = past.slice(-40); while (past.length && past[0].role !== 'user') past.shift(); }
  c.messages = [{ role: 'system', content: SYSTEM }, ...past, { role: 'user', content: `${context(u, c.app)}\n${text}` }];
  return saved(c, advance(u, c, [], []));
}

/** The person approved (possibly after editing the text) or declined the waiting action. */
export async function decide(u: User, { conversation, pending, approve, edits }: { conversation: string; pending: string; approve: boolean; edits?: Record<string, string> }): Promise<Turn> {
  const c = loadConversation(conversation);
  if (!c || !c.waiting || c.waiting.pending.id !== pending || (c.userId !== u.id && u.role !== 'admin')) throw new Error('That request has expired. Ask again.');
  // An admin may decide for a colleague's agent (from Activity); the action still runs as that colleague.
  const decider = u;
  if (c.userId !== u.id) { const owner = listUsers().find((x) => x.id === c.userId); if (!owner) throw new Error('That request has expired. Ask again.'); u = owner; }
  decideActivity(pending, approve, decider.id);
  const { call, args, queue } = c.waiting;
  const pendingSummary = c.waiting.pending.summary;
  c.waiting = undefined;
  const done: Done[] = [];
  if (!approve) {
    // The answer is fixed rather than written by the model: a small model may otherwise
    // say it did the very thing that was just declined.
    c.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'The user declined this action. Do not try it again unless they ask.' }) });
    for (const q of queue) c.messages.push({ role: 'tool', tool_call_id: q.id, content: JSON.stringify({ error: 'Skipped because the user declined an earlier action.' }) });
    const reply = `Not done: ${pendingSummary.charAt(0).toLowerCase()}${pendingSummary.slice(1)}. Tell me what to change, or ask for something else.`;
    c.messages.push({ role: 'assistant', content: reply });
    return saved(c, Promise.resolve({ conversation: c.id, reply, done, pending: null, declined: true }));
  }
  const s = await setupFor(c);
  const editable = new Set((find(s, call.function.name)?.preview?.(args, u) ?? []).filter((p) => p.editable && p.key).map((p) => p.key!));
  for (const [k, v] of Object.entries(edits ?? {})) if (editable.has(k) && typeof v === 'string') args[k] = v.slice(0, 20000);
  c.messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(u, s, c, call, args, done) });
  return saved(c, advance(u, c, queue, done));
}

export const toolCatalog = () => available().map((t) => ({ name: t.name, app: t.app, risk: typeof t.risk === 'function' ? 'send' : t.risk, description: t.description }));
