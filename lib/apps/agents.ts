import crypto from 'node:crypto';
import { loadConfig } from '../config.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { type McpServer, listMcpTools } from '../agent/mcp.ts';
import { type AgentRow, type Skill, memories, parse } from '../agent/profile.ts';
import { TOOLS } from '../agent/tools.ts';
import { type Handlers, need } from '../rpc.ts';

/**
 * Agents: build your own AI workers. Each one is a harness around a model: a role,
 * the tools it may use, MCP servers, skills, memory and context. Agents can be given
 * tasks in Value Factories, or asked directly from the Agents app.
 */
type Ai = { provider?: 'default' | 'openrouter' | 'openai' | 'custom'; baseUrl?: string; model?: string; apiKey?: string };
const PROVIDERS: Record<string, string> = { openrouter: 'https://openrouter.ai/api/v1', openai: 'https://api.openai.com/v1' };

const READ = ['search_everything', 'whats_on_today', 'find_people', 'list_documents', 'list_tasks'];
export const AGENT_TEMPLATES: { id: string; name: string; description: string; role: string; tools: string[]; skills?: Skill[] }[] = [
  { id: 'marketing', name: 'Marketing agent', description: 'Plans and writes marketing: positioning, content and posts.',
    role: 'You are the marketing lead of a small company. You turn goals into clear plans and write plain, specific, honest marketing copy for the company\'s real products. Keep writing short and concrete.',
    tools: [...READ, 'write_document', 'write_presentation', 'draft_linkedin_post', 'create_campaign', 'linkedin_overview', 'create_task', 'complete_task'],
    skills: [{ name: 'positioning', description: 'Write a one-page positioning brief', instructions: 'Write: 1) who it is for, 2) the problem in their words, 3) what we offer, 4) why us (three proof points from the company context only), 5) one-sentence pitch. Save it with write_document.' }] },
  { id: 'campaign', name: 'Campaign agent', description: 'Runs campaigns end to end: brief, posts, leads and follow-up.',
    role: 'You run marketing campaigns for a small company. You write the campaign brief, draft the posts, gather the right leads and prepare follow-ups. Everything that reaches other people is drafted for approval first.',
    tools: [...READ, 'write_document', 'create_campaign', 'draft_linkedin_post', 'linkedin_overview', 'list_leads', 'add_lead', 'update_lead', 'write_linkedin_message', 'create_event', 'create_task'] },
  { id: 'sales', name: 'Sales agent', description: 'Works the sales funnel: leads, deals, follow-ups and quotes.',
    role: 'You are a careful sales assistant. You qualify leads, move deals forward, write short personal follow-ups and prepare quotes. You never promise discounts or terms the company has not given you.',
    tools: [...READ, 'list_deals', 'add_deal', 'move_deal', 'add_contact', 'list_leads', 'lead_to_crm', 'update_lead', 'write_linkedin_message', 'send_email', 'create_quote', 'create_event', 'list_emails', 'read_email', 'write_document'] },
  { id: 'outreach', name: 'Outreach agent', description: 'Finds the right people and writes personal first messages.',
    role: 'You do outreach for a small company: pick the best-fitting people from the leads and contacts, and write short, personal, non-pushy first messages. LinkedIn messages are written for the user to send themselves.',
    tools: [...READ, 'list_leads', 'add_lead', 'update_lead', 'write_linkedin_message', 'send_email', 'add_contact', 'write_document'] },
  { id: 'brand', name: 'Brand agent', description: 'Keeps the voice and look consistent: guidelines, messaging, naming.',
    role: 'You look after the company\'s brand: tone of voice, messaging, naming and simple visual guidelines. You write guidelines people can follow and review copy against them.',
    tools: [...READ, 'write_document', 'write_presentation'] },
  { id: 'builder', name: 'Builder agent', description: 'Specs and plans software, internal tools and low-code apps.',
    role: 'You are a pragmatic software lead. You turn an idea into a short spec (users, screens, data, rules), a task plan, and simple low-code solutions using spreadsheets and documents where they are enough. Give it code-hosting MCP servers (such as GitHub) to let it work on code.',
    tools: [...READ, 'write_document', 'create_spreadsheet', 'read_spreadsheet', 'update_spreadsheet', 'create_task', 'complete_task'] },
  { id: 'automation', name: 'Automation agent', description: 'Maps processes and automates the repetitive parts.',
    role: 'You map how a business process works today, find the steps that repeat, and automate them with the tools you have: recurring invoices, bank matching, tasks, reminders and documented checklists.',
    tools: [...READ, 'write_document', 'create_task', 'create_event', 'set_up_recurring_invoice', 'list_bank_lines', 'match_all_bank_lines', 'list_invoices', 'send_payment_reminder'] },
  { id: 'operations', name: 'Operations agent', description: 'Keeps the day running: inbox, calendar, tasks and money.',
    role: 'You are the company\'s operations assistant. You keep track of what needs attention, tidy up tasks, prepare meetings and keep the books current.',
    tools: [...READ, 'list_emails', 'read_email', 'reply_to_email', 'list_events', 'create_event', 'create_task', 'complete_task', 'list_invoices', 'accounting_summary'] },
];

const installedTools = () => {
  const apps = loadConfig().apps;
  const needs: Record<string, string[]> = { contacts: ['contacts', 'crm'], overview: [] };
  return TOOLS.filter((t) => t.app === 'overview' || (needs[t.app] ?? [t.app]).some((a) => apps.includes(a)));
};

/** What the browser sees: never the API keys or MCP tokens themselves. */
function shown(a: AgentRow) {
  const ai = parse<Ai>(a.ai, {});
  return {
    id: a.id, name: a.name, description: a.description, role: a.role, context: a.context, memory: !!a.memory, template: a.template,
    tools: parse<string[]>(a.tools, []), skills: parse<Skill[]>(a.skills, []),
    mcps: parse<McpServer[]>(a.mcps, []).map((m) => ({ name: m.name, url: m.url, approve: m.approve !== false, hasToken: !!m.token })),
    ai: { provider: ai.provider ?? 'default', baseUrl: ai.provider === 'custom' ? ai.baseUrl ?? '' : '', model: ai.model ?? '', hasKey: !!ai.apiKey },
    memories: a.memory ? memories(a.id).length : 0, updated_at: a.updated_at,
  };
}

export function createAgent(userId: string, a: { name: string; description?: string; role?: string; tools?: string[]; skills?: Skill[]; context?: string; template?: string }): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  run('INSERT INTO agents (id, name, description, role, tools, skills, context, template, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, a.name.trim().slice(0, 80), a.description ?? '', a.role ?? '', JSON.stringify(a.tools ?? []), JSON.stringify(a.skills ?? []), a.context ?? '', a.template ?? '', userId, now, now);
  return id;
}

/** The agent made from a template, creating it the first time it is needed. */
export function agentFromTemplate(userId: string, templateId: string): string {
  const existing = get<{ id: string }>('SELECT id FROM agents WHERE template = ? ORDER BY created_at LIMIT 1', templateId);
  if (existing) return existing.id;
  const t = AGENT_TEMPLATES.find((x) => x.id === templateId);
  need(t, 'Unknown agent template.');
  const allowed = new Set(installedTools().map((x) => x.name));
  return createAgent(userId, { name: t.name, description: t.description, role: t.role, tools: t.tools.filter((n) => allowed.has(n)), skills: t.skills, template: t.id });
}

export const agents: Handlers = {
  'agents.list': () => ({
    agents: all<AgentRow>('SELECT * FROM agents ORDER BY created_at').map(shown),
    templates: AGENT_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })),
    tools: installedTools().map((t) => ({ name: t.name, app: t.app, risk: typeof t.risk === 'function' ? 'send' : t.risk, description: t.description })),
    defaultModel: loadConfig().ai.model,
  }),

  'agents.fromTemplate': (u, { template }: { template: string }) => {
    const t = AGENT_TEMPLATES.find((x) => x.id === template);
    need(t, 'Unknown agent template.');
    const allowed = new Set(installedTools().map((x) => x.name));
    const id = createAgent(u.id, { name: t.name, description: t.description, role: t.role, tools: t.tools.filter((n) => allowed.has(n)), skills: t.skills, template: t.id });
    emit({ type: 'agents.created', app: 'agents', userId: u.id, summary: `You added the agent "${t.name}"`, payload: { agentId: id } });
    return { id };
  },

  'agents.save': (u, b: { id?: string; name: string; description?: string; role?: string; tools?: string[]; skills?: Skill[]; context?: string; memory?: boolean;
    mcps?: { name: string; url: string; token?: string; approve?: boolean }[]; ai?: Ai }) => {
    need(b.name?.trim(), 'Give the agent a name.');
    const old = b.id ? get<AgentRow>('SELECT * FROM agents WHERE id = ?', b.id) : undefined;
    need(!b.id || old, 'That agent no longer exists.');
    const known = new Set(TOOLS.map((t) => t.name));
    const tools = (b.tools ?? []).filter((n) => known.has(n));
    const skills = (b.skills ?? []).filter((s) => s.name?.trim()).slice(0, 30).map((s) => ({ name: s.name.trim().slice(0, 60), description: (s.description ?? '').slice(0, 300), instructions: (s.instructions ?? '').slice(0, 8000) }));
    // MCP tokens and API keys are write-only: an empty field keeps the saved one.
    const oldMcps = parse<McpServer[]>(old?.mcps ?? '[]', []);
    const mcps = (b.mcps ?? []).filter((m) => m.url?.trim()).slice(0, 10).map((m) => {
      need(/^https?:\/\//.test(m.url.trim()), `"${m.url}" is not a web address. MCP servers are added by their https:// address.`);
      const token = m.token?.trim() || oldMcps.find((o) => o.url === m.url.trim())?.token;
      return { name: (m.name?.trim() || new URL(m.url.trim()).host).slice(0, 40), url: m.url.trim(), ...(token ? { token } : {}), approve: m.approve !== false };
    });
    const oldAi = parse<Ai>(old?.ai ?? '{}', {});
    const p = b.ai?.provider ?? 'default';
    const ai: Ai = p === 'default' ? (b.ai?.model?.trim() ? { provider: 'default', model: b.ai.model.trim() } : {}) : {
      provider: p, baseUrl: p === 'custom' ? (b.ai?.baseUrl ?? '').trim().replace(/\/$/, '') : PROVIDERS[p], model: (b.ai?.model ?? '').trim(),
      apiKey: b.ai?.apiKey?.trim() || (oldAi.provider === p ? oldAi.apiKey : undefined),
    };
    if (p !== 'default') {
      need(ai.model, 'Choose which model this agent uses.');
      need(p !== 'custom' || /^https?:\/\//.test(ai.baseUrl ?? ''), 'Enter the address of the AI endpoint, like http://localhost:11434/v1.');
      need(p === 'custom' || ai.apiKey, `Add an API key for ${p === 'openai' ? 'OpenAI' : 'OpenRouter'}.`);
    }
    const now = Date.now();
    const values = [b.name.trim().slice(0, 80), (b.description ?? '').slice(0, 300), (b.role ?? '').slice(0, 8000), JSON.stringify(tools), JSON.stringify(mcps), JSON.stringify(skills), b.memory === false ? 0 : 1, (b.context ?? '').slice(0, 12000), JSON.stringify(ai), now];
    if (old) {
      run('UPDATE agents SET name = ?, description = ?, role = ?, tools = ?, mcps = ?, skills = ?, memory = ?, context = ?, ai = ?, updated_at = ? WHERE id = ?', ...values, old.id);
      return { id: old.id };
    }
    const id = crypto.randomUUID();
    run('INSERT INTO agents (name, description, role, tools, mcps, skills, memory, context, ai, updated_at, id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ...values, id, u.id, now);
    emit({ type: 'agents.created', app: 'agents', userId: u.id, summary: `You built the agent "${b.name.trim()}"`, payload: { agentId: id } });
    return { id };
  },

  'agents.remove': (_u, { id }: { id: string }) => {
    run('UPDATE proj_tasks SET agent_id = NULL WHERE agent_id = ?', id);
    run('DELETE FROM agent_memory WHERE agent_id = ?', id);
    run('DELETE FROM agents WHERE id = ?', id);
  },

  'agents.memories': (_u, { id }: { id: string }) => memories(id),
  'agents.forget': (_u, { id }: { id: string }) => { run('DELETE FROM agent_memory WHERE id = ?', id); },

  /** Check an MCP server answers, and list its tools. */
  'agents.checkMcp': async (_u, { agent, url, token }: { agent?: string; url: string; token?: string }) => {
    need(/^https?:\/\//.test(url?.trim() ?? ''), 'Enter the server\'s https:// address.');
    const saved = agent ? parse<McpServer[]>(get<AgentRow>('SELECT * FROM agents WHERE id = ?', agent)?.mcps ?? '[]', []).find((m) => m.url === url.trim())?.token : undefined;
    const tools = await listMcpTools({ name: 'check', url: url.trim(), token: token?.trim() || saved }, true);
    return { tools: tools.map((t) => ({ name: t.name, description: t.description ?? '' })) };
  },
};
