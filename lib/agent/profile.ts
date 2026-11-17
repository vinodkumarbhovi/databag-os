import crypto from 'node:crypto';
import type { AiOverride } from '../ai.ts';
import { loadConfig } from '../config.ts';
import { all, get, run } from '../db.ts';
import { need } from '../rpc.ts';
import { type McpServer, callMcpTool, listMcpTools, mcpToolName } from './mcp.ts';
import { TOOLS, type Tool } from './tools.ts';

/**
 * An agent someone built in the Agents app. Its "harness" is everything it works with:
 * - role:    who it is and how it works (the system prompt);
 * - tools:   which databag actions it may use (mail, CRM, docs, LinkedIn…);
 * - MCPs:    outside tool servers it may call (GitHub, Notion, a company API…);
 * - skills:  named playbooks it reads when a job calls for them;
 * - memory:  facts it chose to remember between jobs;
 * - context: background it should always know (products, tone, customers);
 * - model:   the company's AI, or its own provider and model.
 */
export type Skill = { name: string; description: string; instructions: string };
export type AgentRow = {
  id: string; name: string; description: string; role: string; tools: string; mcps: string; skills: string;
  memory: number; context: string; ai: string; template: string; created_by: string; created_at: number; updated_at: number;
};
export type Profile = { id: string; name: string; system: string; tools: Tool[]; ai?: AiOverride };

export const parse = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };

/** How every agent works, whatever its role. */
export const RULES = [
  'How to work:',
  '- Do the task with tools instead of describing how the user could do it. Use several tools in a row when needed (look something up, then act on it).',
  '- People can be named ("Ben", "Priya Shah"): tools find their email address. Only ask when a tool says someone is unknown or ambiguous.',
  '- Do not ask for details you can sensibly choose: meetings default to 30 minutes; emails get a short friendly text signed with the user\'s first name (never a placeholder like [Name]).',
  '- Some actions wait for the user to approve them on screen; that is normal, just call the tool.',
  '- When asked to go through several items, handle every one of them before replying; a result\'s next_step says what to call.',
  '- Never sign a document for the user: only they can do that, in Sign.',
  '- Never invent customers, numbers, quotes or results. If information is missing, say what is missing.',
].join('\n');

export const memories = (agentId: string) => all<{ id: string; fact: string; created_at: number }>('SELECT id, fact, created_at FROM agent_memory WHERE agent_id = ? ORDER BY created_at DESC LIMIT 40', agentId);

/** Build the working agent: its instructions and the tools it may use. */
export async function loadProfile(agentId: string): Promise<Profile> {
  const a = get<AgentRow>('SELECT * FROM agents WHERE id = ?', agentId);
  need(a, 'That agent no longer exists.');
  const allowed = new Set(parse<string[]>(a.tools, []));
  const tools: Tool[] = TOOLS.filter((t) => allowed.has(t.name));
  const skills = parse<Skill[]>(a.skills, []).filter((s) => s.name?.trim());
  const mcps = parse<McpServer[]>(a.mcps, []).filter((m) => m.url?.trim());
  const notes: string[] = [];

  if (skills.length) {
    tools.push({
      name: 'read_skill', app: 'agents', risk: 'read', description: 'Read the full instructions of one of your skills before doing work it covers.',
      params: { name: { type: 'string', enum: skills.map((s) => s.name) } }, required: ['name'],
      summary: (x) => `Read the skill "${String(x.name)}"`,
      run: (_u, x) => { const s = skills.find((k) => k.name === x.name); need(s, 'No such skill.'); return { instructions: s.instructions }; },
    });
    notes.push(`Your skills (call read_skill before doing work one covers):\n${skills.map((s) => `- ${s.name}: ${s.description || s.instructions.slice(0, 120)}`).join('\n')}`);
  }

  if (a.memory) {
    tools.push(
      { name: 'remember', app: 'agents', risk: 'read', description: 'Save a short fact worth knowing next time (a preference, a decision, a result). Not for secrets.',
        params: { fact: { type: 'string' } }, required: ['fact'], summary: (x) => `Remembered: ${String(x.fact).slice(0, 80)}`,
        run: (_u, x) => { const fact = String(x.fact ?? '').trim().slice(0, 500); need(fact, 'Nothing to remember.'); run('INSERT INTO agent_memory (id, agent_id, fact, created_at) VALUES (?, ?, ?, ?)', crypto.randomUUID(), a.id, fact, Date.now()); return { ok: true }; } },
      { name: 'forget', app: 'agents', risk: 'read', description: 'Remove a remembered fact that is wrong or out of date.',
        params: { fact: { type: 'string', description: 'Words from the fact' } }, required: ['fact'], summary: () => 'Forgot a fact',
        run: (_u, x) => { const r = memories(a.id).find((m) => m.fact.toLowerCase().includes(String(x.fact ?? '').toLowerCase())); need(r, 'No remembered fact matches.'); run('DELETE FROM agent_memory WHERE id = ?', r.id); return { ok: true }; } },
    );
    const facts = memories(a.id);
    notes.push(facts.length ? `What you remember from earlier work (newest first):\n${facts.map((m) => `- ${m.fact}`).join('\n')}` : 'You have no memories yet. Use remember for facts worth keeping.');
  }

  for (const server of mcps) {
    try {
      for (const t of await listMcpTools(server)) {
        tools.push({
          name: mcpToolName(server.name, t.name), app: 'agents', risk: server.approve === false ? 'change' : 'send',
          description: `[${server.name}] ${t.description ?? t.name}`.slice(0, 1000),
          params: ((t.inputSchema?.properties ?? {}) as Tool['params']), required: (t.inputSchema?.required as string[]) ?? [],
          summary: () => `Use ${t.name} on ${server.name}`,
          preview: (x) => [{ label: 'Details', value: JSON.stringify(x, null, 2).slice(0, 2000) }],
          run: (_u, x) => callMcpTool(server, t.name, x),
        });
      }
    } catch (err) {
      notes.push(`The MCP server "${server.name}" could not be reached (${(err as Error).message}); its tools are not available now.`);
    }
  }

  const company = loadConfig().company;
  const system = [
    a.role.trim() || `You are ${a.name}, an agent working for ${company.name}.`,
    `You are "${a.name}", an AI agent working inside ${company.name}'s databag company OS. Each user message starts with a line in square brackets giving the user, the date and the app; use it to work out dates and write times as YYYY-MM-DD HH:MM.`,
    RULES,
    a.context.trim() ? `Background you should always use:\n${a.context.trim()}` : '',
    ...notes,
    'When finished, reply with what you did or produced, in plain text without markdown headings. Include the actual content you wrote when the task asks for writing. Never claim something happened unless a tool result says so.',
  ].filter(Boolean).join('\n\n');

  const ai = parse<AiOverride>(a.ai, {});
  return { id: a.id, name: a.name, system, tools, ai: ai.baseUrl || ai.model ? ai : undefined };
}

