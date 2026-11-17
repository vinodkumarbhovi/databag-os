'use client';

import { Bot, Brain, Check, Loader2, Plug, Plus, Send, Trash2, Wrench, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { call, rpc, when } from '@/lib/client';
import type { Pending, Turn } from '@/lib/agent/agent';
import { useToast } from './ui';

type Skill = { name: string; description: string; instructions: string };
type Mcp = { name: string; url: string; token?: string; approve: boolean; hasToken?: boolean };
type Ai = { provider: 'default' | 'openrouter' | 'openai' | 'custom'; baseUrl: string; model: string; apiKey?: string; hasKey?: boolean };
type Agent = { id?: string; name: string; description: string; role: string; context: string; memory: boolean; tools: string[]; skills: Skill[]; mcps: Mcp[]; ai: Ai; memories?: number };
type ToolInfo = { name: string; app: string; risk: string; description: string };
type Data = { agents: Agent[]; templates: { id: string; name: string; description: string }[]; tools: ToolInfo[]; defaultModel: string };

const SECTIONS = ['Role', 'Model', 'Tools', 'MCP servers', 'Skills', 'Memory', 'Context', 'Try it'] as const;
type Section = (typeof SECTIONS)[number];
const blank = (): Agent => ({ name: 'New agent', description: '', role: '', context: '', memory: true, tools: ['search_everything', 'whats_on_today'], skills: [], mcps: [], ai: { provider: 'default', baseUrl: '', model: '' } });
const RISK: Record<string, string> = { read: 'reads', change: 'changes data', send: 'reaches people' };

/** Build agents: everything an agent works with (its harness), one section at a time. */
export function AgentsApp() {
  const [data, setData] = useState<Data | null>(null);
  const [edit, setEdit] = useState<Agent | null>(null);
  const [section, setSection] = useState<Section>('Role');
  const [dirty, setDirty] = useState(false);
  const { toast, attempt } = useToast();

  const load = useCallback(async (select?: string) => {
    const d = await rpc<Data>('agents.list').catch(() => null);
    if (!d) return;
    setData(d);
    const pick = d.agents.find((a) => a.id === (select ?? edit?.id)) ?? (select === undefined && !edit ? d.agents[0] : undefined);
    if (pick) { setEdit(structuredClone(pick)); setDirty(false); }
  }, [edit]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (patch: Partial<Agent>) => { setEdit((e) => (e ? { ...e, ...patch } : e)); setDirty(true); };
  const save = async () => {
    let id = edit!.id;
    if (await attempt(async () => { id = (await rpc<{ id: string }>('agents.save', edit)).id; }, 'Agent saved.')) load(id);
  };
  const fromTemplate = async (template: string) => {
    let id = '';
    if (await attempt(async () => { id = (await rpc<{ id: string }>('agents.fromTemplate', { template })).id; }, 'Agent added.')) { setSection('Role'); load(id); }
  };
  const remove = async () => {
    if (!edit?.id || !window.confirm(`Delete "${edit.name}" and what it remembers? Tasks given to it are kept, without an agent.`)) return;
    if (await attempt(() => rpc('agents.remove', { id: edit.id }), 'Deleted.')) { setEdit(null); load(''); }
  };
  if (!data) return <div className="app"><div className="body"><Loader2 className="spin" size={18} /></div></div>;

  return (
    <div className="app">
      <div className="bar">
        <select className="tool-select" aria-label="Agent" value={edit?.id ?? ''} onChange={(e) => { const a = data.agents.find((x) => x.id === e.target.value); if (a && (!dirty || window.confirm('Leave without saving?'))) { setEdit(structuredClone(a)); setDirty(false); } }}>
          {!edit?.id && <option value="">{edit ? `${edit.name} (not saved)` : 'Choose an agent'}</option>}
          {data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <span className="grow-gap" />
        <button className="btn" onClick={() => { setEdit(blank()); setSection('Role'); setDirty(true); }}><Plus size={15} /> Build an agent</button>
        {edit && <button className="btn primary" disabled={!dirty} onClick={save}><Check size={15} /> Save</button>}
      </div>
      <div className="body">
        {!edit ? (
          <>
            <p className="muted" style={{ marginTop: 0 }}>An agent is a model with a harness: a role, the tools it may use, MCP servers, skills, memory and context. Start from one of these, or build your own.</p>
            <Templates templates={data.templates} onPick={fromTemplate} />
          </>
        ) : (
          <div className="agent-builder">
            <nav className="agent-nav" aria-label="Agent sections">
              {SECTIONS.map((s) => <button key={s} className={section === s ? 'on' : ''} onClick={() => setSection(s)}>{s}{s === 'Tools' ? ` (${edit.tools.length})` : s === 'MCP servers' ? ` (${edit.mcps.length})` : s === 'Skills' ? ` (${edit.skills.length})` : ''}</button>)}
              {edit.id && <button className="danger" onClick={remove}><Trash2 size={13} /> Delete agent</button>}
            </nav>
            <div className="agent-pane">
              {section === 'Role' && (
                <>
                  <label className="field"><span className="label">Name</span><input className="input" value={edit.name} onChange={(e) => change({ name: e.target.value })} /></label>
                  <label className="field"><span className="label">What it is for (shown when picking an agent)</span><input className="input" value={edit.description} onChange={(e) => change({ description: e.target.value })} /></label>
                  <label className="field"><span className="label">System role: who it is and how it works</span>
                    <textarea className="input area" rows={9} placeholder="You are the company’s sales assistant. You…" value={edit.role} onChange={(e) => change({ role: e.target.value })} /></label>
                  <p className="muted small">databag adds the working rules every agent follows (use tools, ask before anything goes out, never invent results), plus its skills, memory and context.</p>
                </>
              )}
              {section === 'Model' && <ModelPane ai={edit.ai} defaultModel={data.defaultModel} onChange={(ai) => change({ ai })} />}
              {section === 'Tools' && <ToolsPane tools={data.tools} chosen={edit.tools} onChange={(tools) => change({ tools })} />}
              {section === 'MCP servers' && <McpPane agentId={edit.id} mcps={edit.mcps} onChange={(mcps) => change({ mcps })} attempt={attempt} />}
              {section === 'Skills' && <SkillsPane skills={edit.skills} onChange={(skills) => change({ skills })} />}
              {section === 'Memory' && <MemoryPane agent={edit} onToggle={(memory) => change({ memory })} attempt={attempt} />}
              {section === 'Context' && (
                <label className="field"><span className="label">Background it always knows: products, prices, customers, tone, links</span>
                  <textarea className="input area" rows={14} placeholder="We sell… Our customers are… We write in a friendly, plain tone…" value={edit.context} onChange={(e) => change({ context: e.target.value })} /></label>
              )}
              {section === 'Try it' && (edit.id && !dirty ? <TryIt agent={edit} /> : <div className="notice">Save the agent first, then try it here.</div>)}
            </div>
          </div>
        )}
        {edit && (
          <details style={{ marginTop: 24 }}>
            <summary className="muted small" style={{ cursor: 'pointer' }}>Add another from a template</summary>
            <div style={{ marginTop: 10 }}><Templates templates={data.templates} onPick={fromTemplate} /></div>
          </details>
        )}
      </div>
      {toast}
    </div>
  );
}

function Templates({ templates, onPick }: { templates: Data['templates']; onPick: (id: string) => void }) {
  return (
    <div className="choice-grid">
      {templates.map((t) => <button key={t.id} type="button" className="choice" onClick={() => onPick(t.id)}><strong><Bot size={13} /> {t.name}</strong><span>{t.description}</span></button>)}
    </div>
  );
}

function ModelPane({ ai, defaultModel, onChange }: { ai: Ai; defaultModel: string; onChange: (ai: Ai) => void }) {
  const set = (patch: Partial<Ai>) => onChange({ ...ai, ...patch });
  const hint = ai.provider === 'openrouter' ? 'e.g. google/gemini-2.5-flash or anthropic/claude-sonnet-4.5' : ai.provider === 'openai' ? 'e.g. gpt-4.1-mini' : ai.provider === 'custom' ? 'the model name the endpoint expects' : `leave empty for the company model (${defaultModel})`;
  return (
    <>
      <div className="choice-grid">
        {([['default', 'Company AI', `The model set in Settings (${defaultModel}). Free and private when it runs locally.`], ['openrouter', 'OpenRouter', 'Hundreds of models with one key.'], ['openai', 'OpenAI', 'GPT models with your OpenAI key.'], ['custom', 'Other endpoint', 'Any OpenAI-compatible address (LM Studio, vLLM, another Ollama).']] as const).map(([v, l, d]) => (
          <button key={v} type="button" className={`choice ${ai.provider === v ? 'on' : ''}`} aria-pressed={ai.provider === v} onClick={() => set({ provider: v })}><strong>{l}</strong><span>{d}</span></button>
        ))}
      </div>
      {ai.provider === 'custom' && <label className="field"><span className="label">Endpoint address</span><input className="input" placeholder="http://localhost:1234/v1" value={ai.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></label>}
      <label className="field"><span className="label">Model</span><input className="input" placeholder={hint} value={ai.model} onChange={(e) => set({ model: e.target.value })} /></label>
      {ai.provider !== 'default' && (
        <label className="field"><span className="label">API key {ai.hasKey ? '(saved; leave empty to keep it)' : ai.provider === 'custom' ? '(if the endpoint needs one)' : ''}</span>
          <input className="input" type="password" autoComplete="off" value={ai.apiKey ?? ''} onChange={(e) => set({ apiKey: e.target.value })} /></label>
      )}
      <p className="muted small">The model must support tool calling. Keys are stored in your databag database and never shown again.</p>
    </>
  );
}

function ToolsPane({ tools, chosen, onChange }: { tools: ToolInfo[]; chosen: string[]; onChange: (t: string[]) => void }) {
  const apps = [...new Set(tools.map((t) => t.app))];
  const toggle = (n: string) => onChange(chosen.includes(n) ? chosen.filter((x) => x !== n) : [...chosen, n]);
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>What this agent may do in databag. Anything that reaches other people always waits for someone’s OK.</p>
      {apps.map((app) => (
        <div key={app} className="tool-group">
          <div className="label" style={{ textTransform: 'capitalize' }}>{app === 'overview' ? 'Everywhere' : app}</div>
          {tools.filter((t) => t.app === app).map((t) => (
            <label key={t.name} className="tool-check">
              <input type="checkbox" checked={chosen.includes(t.name)} onChange={() => toggle(t.name)} />
              <span><span className="mono">{t.name}</span> <span className={`badge ${t.risk === 'send' ? 'warn' : ''}`}>{RISK[t.risk]}</span><br /><span className="muted small">{t.description}</span></span>
            </label>
          ))}
        </div>
      ))}
    </>
  );
}

function McpPane({ agentId, mcps, onChange, attempt }: { agentId?: string; mcps: Mcp[]; onChange: (m: Mcp[]) => void; attempt: (a: () => Promise<unknown>, done?: string) => Promise<boolean> }) {
  const [found, setFound] = useState<Record<number, string>>({});
  const set = (i: number, patch: Partial<Mcp>) => onChange(mcps.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const check = (i: number) => attempt(async () => {
    const r = await rpc<{ tools: { name: string }[] }>('agents.checkMcp', { agent: agentId, url: mcps[i].url, token: mcps[i].token });
    setFound((f) => ({ ...f, [i]: r.tools.length ? `${r.tools.length} tool${r.tools.length === 1 ? "" : "s"}: ${r.tools.map((t) => t.name).slice(0, 12).join(', ')}${r.tools.length > 12 ? '…' : ''}` : 'Connected, but it offers no tools.' }));
  });
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>MCP servers give the agent outside tools: GitHub, Notion, Linear, your own APIs. Add a server by its web address (Streamable HTTP). Servers that run as a local program can be put behind an HTTP bridge first.</p>
      {mcps.map((m, i) => (
        <div key={i} className="panel pad stack" style={{ marginBottom: 10 }}>
          <div className="two">
            <label className="field"><span className="label">Name</span><input className="input" placeholder="github" value={m.name} onChange={(e) => set(i, { name: e.target.value })} /></label>
            <label className="field"><span className="label">Address</span><input className="input" placeholder="https://example.com/mcp" value={m.url} onChange={(e) => set(i, { url: e.target.value })} /></label>
          </div>
          <label className="field"><span className="label">Access token {m.hasToken ? '(saved; leave empty to keep it)' : '(optional)'}</span><input className="input" type="password" autoComplete="off" value={m.token ?? ''} onChange={(e) => set(i, { token: e.target.value })} /></label>
          <label className="tool-check"><input type="checkbox" checked={m.approve} onChange={(e) => set(i, { approve: e.target.checked })} /><span>Ask for approval before each use of this server’s tools <span className="muted small">(recommended)</span></span></label>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" disabled={!m.url} onClick={() => check(i)}><Plug size={14} /> Check connection</button>
            <button type="button" className="btn ghost" onClick={() => onChange(mcps.filter((_, j) => j !== i))}><X size={14} /> Remove</button>
          </div>
          {found[i] && <div className="muted small">{found[i]}</div>}
        </div>
      ))}
      <button type="button" className="btn" onClick={() => onChange([...mcps, { name: '', url: '', approve: true }])}><Plus size={14} /> Add an MCP server</button>
    </>
  );
}

function SkillsPane({ skills, onChange }: { skills: Skill[]; onChange: (s: Skill[]) => void }) {
  const set = (i: number, patch: Partial<Skill>) => onChange(skills.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>Skills are playbooks: step-by-step instructions for one kind of job. The agent sees each skill’s name and summary, and reads the full instructions when a job needs them.</p>
      {skills.map((s, i) => (
        <div key={i} className="panel pad stack" style={{ marginBottom: 10 }}>
          <div className="two">
            <label className="field"><span className="label">Name</span><input className="input" placeholder="weekly-report" value={s.name} onChange={(e) => set(i, { name: e.target.value })} /></label>
            <label className="field"><span className="label">When to use it</span><input className="input" placeholder="Writing the weekly sales report" value={s.description} onChange={(e) => set(i, { description: e.target.value })} /></label>
          </div>
          <label className="field"><span className="label">Instructions</span><textarea className="input area" rows={6} value={s.instructions} onChange={(e) => set(i, { instructions: e.target.value })} /></label>
          <div><button type="button" className="btn ghost" onClick={() => onChange(skills.filter((_, j) => j !== i))}><X size={14} /> Remove skill</button></div>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => onChange([...skills, { name: '', description: '', instructions: '' }])}><Wrench size={14} /> Add a skill</button>
    </>
  );
}

function MemoryPane({ agent, onToggle, attempt }: { agent: Agent; onToggle: (on: boolean) => void; attempt: (a: () => Promise<unknown>, done?: string) => Promise<boolean> }) {
  const [list, setList] = useState<{ id: string; fact: string; created_at: number }[]>([]);
  const load = useCallback(() => { if (agent.id) rpc<typeof list>('agents.memories', { id: agent.id }).then(setList).catch(() => {}); }, [agent.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <label className="tool-check"><input type="checkbox" checked={agent.memory} onChange={(e) => onToggle(e.target.checked)} /><span><Brain size={13} /> Let this agent remember facts between jobs (preferences, decisions, results)</span></label>
      <div className="panel" style={{ marginTop: 12 }}>
        {list.length === 0 && <div className="panel-empty">Nothing remembered yet.</div>}
        {list.map((m) => (
          <div key={m.id} className="panel-row compact">
            <span className="grow">{m.fact}</span><span className="muted small">{when(m.created_at)}</span>
            <button className="btn ghost icon" aria-label="Forget this" onClick={async () => { if (await attempt(() => rpc('agents.forget', { id: m.id }))) load(); }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </>
  );
}

type Line = { who: 'you' | 'agent'; text: string } | { who: 'pending'; pending: Pending; state: 'open' | 'done' };
function TryIt({ agent }: { agent: Agent }) {
  const [log, setLog] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversation, setConversation] = useState<string>();
  const take = (t: Turn) => {
    setConversation(t.conversation);
    setLog((l) => [...l, ...t.done.map((d) => ({ who: 'agent' as const, text: `${d.ok ? '✓' : '✗'} ${d.summary}${d.error ? ` (${d.error})` : ''}` })), ...(t.reply ? [{ who: 'agent' as const, text: t.reply }] : []), ...(t.pending ? [{ who: 'pending' as const, pending: t.pending, state: 'open' as const }] : [])]);
  };
  const go = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { take(await call<Turn>('/api/agent', { body: { ...body, conversation, agent: agent.id, app: 'agents' } })); }
    catch (err) { setLog((l) => [...l, { who: 'agent', text: (err as Error).message }]); }
    setBusy(false);
  };
  const send = (e: React.FormEvent) => { e.preventDefault(); if (!text.trim()) return; setLog((l) => [...l, { who: 'you', text }]); setText(''); go({ message: text }); };
  const decide = (p: Pending, approve: boolean) => { setLog((l) => l.map((x) => (x.who === 'pending' && x.pending.id === p.id ? { ...x, state: 'done' } : x))); go({ pending: p.id, approve }); };
  return (
    <div className="stack">
      <div className="try-log">
        {log.length === 0 && <div className="muted small">Ask {agent.name} to do something. It works with its own tools, skills and memory, and asks before anything goes out.</div>}
        {log.map((l, i) => l.who === 'pending' ? (
          <div key={i} className={`approve ${l.state === 'done' ? 'approved' : ''}`}>
            <div className="approve-head">Needs your OK</div>
            <div>{l.pending.summary}</div>
            {l.pending.preview.map((f) => <div key={f.label} className="approve-field"><span className="label">{f.label}</span><div style={{ whiteSpace: 'pre-wrap' }}>{f.value}</div></div>)}
            {l.state === 'open' && <div className="approve-buttons"><button className="btn" onClick={() => decide(l.pending, false)}>Don’t</button><button className="btn primary" onClick={() => decide(l.pending, true)}><Check size={14} /> Do it</button></div>}
          </div>
        ) : <div key={i} className={`bubble ${l.who === 'you' ? 'from-user' : 'from-ai'}`} style={{ whiteSpace: 'pre-wrap' }}>{l.text}</div>)}
        {busy && <div className="muted small"><Loader2 size={13} className="spin" /> Working…</div>}
      </div>
      <form className="ai-row" onSubmit={send}>
        <input className="input" aria-label={`Ask ${agent.name}`} placeholder={`Ask ${agent.name}…`} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn primary" disabled={busy || !text.trim()}><Send size={14} /> Send</button>
      </form>
    </div>
  );
}
