'use client';

import { Bot, Check, ChevronDown, ChevronRight, Factory, Loader2, Play, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '@/lib/client';
import type { Done, Pending } from '@/lib/agent/agent';
import { Field, Modal, useToast } from './ui';

type FactoryRow = { id: string; name: string; description: string; goal: string; template: string; total: number; done: number; waiting: number };
type Template = { id: string; name: string; description: string; goal: string };
type AgentRef = { id: string; name: string; description: string };
type Task = { id: string; title: string; notes: string; status: string; agent_id: string | null; agent: string | null; state: string; output: string; pending: Pending | null; log: Done[] };
type Data = { factories: FactoryRow[]; templates: Template[]; agents: AgentRef[] };

const STATE: Record<string, string> = { running: 'Working…', waiting: 'Needs your OK', review: 'Ready for review', done: 'Accepted', failed: 'Did not finish' };

/** Value Factories: projects whose to-do lists are worked by agents. */
export function FactoriesApp() {
  const [data, setData] = useState<Data | null>(null);
  const [at, setAt] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [creating, setCreating] = useState<{ template: string; name: string; goal: string } | null>(null);
  const [adding, setAdding] = useState('');
  const [planGoal, setPlanGoal] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [runningAll, setRunningAll] = useState(false);
  const stopAll = useRef(false);
  const { toast, attempt } = useToast();
  const current = data?.factories.find((f) => f.id === at);

  const loadTasks = useCallback(async (id: string) => setTasks(id ? await rpc<Task[]>('factories.tasks', { id }).catch(() => []) : []), []);
  const load = useCallback(async (to?: string) => {
    const d = await rpc<Data>('factories.list').catch(() => null);
    if (!d) return;
    setData(d);
    const next = to ?? (d.factories.some((f) => f.id === at) ? at : d.factories[0]?.id ?? '');
    setAt(next);
    await loadTasks(next);
  }, [at, loadTasks]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    let id = '';
    if (await attempt(async () => { id = (await rpc<{ id: string }>('factories.create', creating)).id; }, 'Factory created.')) { setCreating(null); load(id); }
  };
  const runTask = async (t: Task) => {
    setBusy((b) => ({ ...b, [t.id]: true }));
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, state: 'running' } : x)));
    const ok = await attempt(() => rpc('factories.run', { id: t.id }));
    setBusy((b) => ({ ...b, [t.id]: false }));
    await load(at);
    return ok;
  };
  const decide = async (t: Task, approve: boolean, edits?: Record<string, string>) => {
    setBusy((b) => ({ ...b, [t.id]: true }));
    await attempt(() => rpc('factories.decide', { id: t.id, approve, edits }));
    setBusy((b) => ({ ...b, [t.id]: false }));
    load(at);
  };
  /** Work down the list in order; stop at the first task that needs a person. */
  const runAll = async () => {
    setRunningAll(true); stopAll.current = false;
    for (const t of tasks) {
      if (stopAll.current) break;
      if (t.status === 'done' || !t.agent_id || ['waiting', 'review'].includes(t.state)) continue;
      if (!(await runTask(t))) break;
      const fresh = await rpc<Task[]>('factories.tasks', { id: at }).catch(() => []);
      if (fresh.find((x) => x.id === t.id)?.state === 'waiting') break;
    }
    setRunningAll(false);
  };
  const plan = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy((b) => ({ ...b, plan: true }));
    if (await attempt(() => rpc('projects.aiPlan', { project_id: at, goal: planGoal }), 'Tasks added. Give them to agents.')) { setPlanGoal(''); load(at); }
    setBusy((b) => ({ ...b, plan: false }));
  };

  if (!data) return <div className="app"><div className="body"><Loader2 className="spin" size={18} /></div></div>;
  const ready = tasks.filter((t) => t.status !== 'done' && t.agent_id && !['waiting', 'review'].includes(t.state)).length;

  return (
    <div className="app">
      <div className="bar">
        {data.factories.length > 0 && (
          <select className="tool-select" aria-label="Factory" value={at} onChange={(e) => load(e.target.value)}>
            {data.factories.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.done}/{f.total}{f.waiting ? `, ${f.waiting} waiting` : ''})</option>)}
          </select>
        )}
        <span className="grow-gap" />
        <button className="btn" onClick={() => setCreating({ template: 'campaign', name: '', goal: '' })}><Plus size={15} /> New factory</button>
        {current && (runningAll
          ? <button className="btn" onClick={() => { stopAll.current = true; }}><X size={15} /> Stop after this task</button>
          : <button className="btn primary" disabled={!ready} onClick={runAll}><Play size={15} /> Run all ({ready})</button>)}
      </div>
      <div className="body">
        {!current ? (
          <>
            <p className="muted" style={{ marginTop: 0 }}>A value factory is a project that agents work on: a goal, a to-do list, and an agent for each task. Pick one to start.</p>
            <TemplateGrid templates={data.templates} onPick={(t) => setCreating({ template: t.id, name: '', goal: '' })} />
          </>
        ) : (
          <>
            <div className="factory-head">
              <div className="panel-icon"><Factory size={16} /></div>
              <div className="grow">
                <div className="muted small">{current.description}</div>
                <div><strong>Goal:</strong> {current.goal || <span className="muted">no goal yet</span>}</div>
              </div>
              <div className="meter-bar" style={{ width: 140 }}><div style={{ width: `${current.total ? (current.done / current.total) * 100 : 0}%` }} /></div>
              <span className="mono small">{current.done}/{current.total}</span>
            </div>
            {tasks.length === 0 && (
              <form className="ai-row" onSubmit={plan}>
                <input className="input" aria-label="Plan tasks" placeholder="Describe what this factory should deliver and AI will plan the tasks…" value={planGoal} onChange={(e) => setPlanGoal(e.target.value)} />
                <button className="btn" disabled={busy.plan || !planGoal.trim()}>{busy.plan ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} Plan it</button>
              </form>
            )}
            <div className="factory-tasks">
              {tasks.map((t, i) => <TaskCard key={t.id} n={i + 1} task={t} agents={data.agents} busy={!!busy[t.id]} onRun={() => runTask(t)} onDecide={(ok, edits) => decide(t, ok, edits)}
                onAssign={(agent_id) => attempt(() => rpc('factories.updateTask', { id: t.id, agent_id })).then(() => load(at))}
                onReset={() => attempt(() => rpc('factories.resetTask', { id: t.id })).then(() => load(at))}
                onAccept={() => attempt(() => rpc('factories.accept', { id: t.id }), 'Accepted.').then(() => load(at))} />)}
            </div>
            <form className="inline-form" style={{ marginTop: 12 }} onSubmit={async (e) => { e.preventDefault(); if (adding.trim() && (await attempt(() => rpc('factories.addTask', { id: at, title: adding, agent_id: tasks.at(-1)?.agent_id ?? data.agents[0]?.id })))) { setAdding(''); load(at); } }}>
              <input className="input" aria-label="Add a task" placeholder="+ Add a task and press Enter" value={adding} onChange={(e) => setAdding(e.target.value)} />
            </form>
            {data.agents.length === 0 && <p className="muted small">No agents yet. Build one in the Agents app, or create a factory from a template to get one.</p>}
          </>
        )}
      </div>
      {creating && (
        <Modal title="New value factory" onClose={() => setCreating(null)} wide>
          <TemplateGrid templates={data.templates} chosen={creating.template} onPick={(t) => setCreating({ ...creating, template: t.id })} />
          <div className="two" style={{ marginTop: 12 }}>
            <Field label="Name"><input className="input" placeholder={data.templates.find((t) => t.id === creating.template)?.name} value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} /></Field>
            <Field label="Goal"><input className="input" placeholder={data.templates.find((t) => t.id === creating.template)?.goal || 'What should it deliver?'} value={creating.goal} onChange={(e) => setCreating({ ...creating, goal: e.target.value })} /></Field>
          </div>
          <p className="muted small">The factory starts with a to-do list and an agent made for this kind of work. You can change both.</p>
          <div className="modal-foot"><button className="btn primary" onClick={create}>Create factory</button></div>
        </Modal>
      )}
      {toast}
    </div>
  );
}

function TemplateGrid({ templates, chosen, onPick }: { templates: Template[]; chosen?: string; onPick: (t: Template) => void }) {
  return (
    <div className="choice-grid">
      {templates.map((t) => <button key={t.id} type="button" className={`choice ${chosen === t.id ? 'on' : ''}`} aria-pressed={chosen === t.id} onClick={() => onPick(t)}><strong>{t.name}</strong><span>{t.description}</span></button>)}
    </div>
  );
}

function TaskCard({ n, task: t, agents, busy, onRun, onDecide, onAssign, onReset, onAccept }: {
  n: number; task: Task; agents: AgentRef[]; busy: boolean; onRun: () => void; onDecide: (ok: boolean, edits?: Record<string, string>) => void; onAssign: (id: string) => void; onReset: () => void; onAccept: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const running = busy || t.state === 'running';
  return (
    <div className={`factory-task ${t.status === 'done' ? 'is-done' : ''}`}>
      <div className="factory-task-row">
        <span className="mono muted small" style={{ width: 22 }}>{n}</span>
        <button className="btn ghost icon" aria-label={open ? 'Hide details' : 'Show details'} onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        <div className="grow">
          <div style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined }}>{t.title}</div>
          {t.notes && <div className="muted small">{t.notes}</div>}
        </div>
        <label className="agent-pick"><Bot size={13} />
          <select aria-label={`Agent for ${t.title}`} value={t.agent_id ?? ''} disabled={running} onChange={(e) => onAssign(e.target.value)}>
            <option value="">No agent (a person does it)</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {t.state && <span className={`badge ${t.state === 'done' ? 'good' : t.state === 'review' ? 'info' : t.state === 'waiting' || t.state === 'failed' ? 'warn' : ''}`}>{running ? STATE.running : STATE[t.state]}</span>}
        {t.state === 'review' && !running && <button className="btn primary" onClick={onAccept}><Check size={14} /> Accept</button>}
        {['done', 'failed', 'review'].includes(t.state)
          ? <button className="btn ghost icon" title="Run again" aria-label={`Run "${t.title}" again`} disabled={running} onClick={onReset}><RotateCcw size={14} /></button>
          : <button className="btn" disabled={running || !t.agent_id || t.state === 'waiting'} onClick={onRun}>{running ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Run</button>}
      </div>
      {t.pending && t.state === 'waiting' && (
        <div className="approve" style={{ margin: '8px 0 4px 54px' }}>
          <div className="approve-head">{t.pending.risk === 'send' ? 'Needs your OK: this goes to other people' : 'Needs your OK'}</div>
          <div>{t.pending.summary}</div>
          {t.pending.preview.map((f) => (
            <label key={f.label} className="approve-field"><span className="label">{f.label}</span>
              {f.editable && f.key ? <textarea className="input" rows={Math.min(10, f.value.split('\n').length + 1)} defaultValue={f.value} onChange={(e) => setEdits({ ...edits, [f.key!]: e.target.value })} /> : <div style={{ whiteSpace: 'pre-wrap' }}>{f.value}</div>}
            </label>
          ))}
          <div className="approve-buttons">
            <button className="btn" disabled={busy} onClick={() => onDecide(false)}>Don’t</button>
            <button className="btn primary" disabled={busy} onClick={() => onDecide(true, edits)}><Check size={14} /> {t.pending.risk === 'send' ? 'Send it' : 'Do it'}</button>
          </div>
        </div>
      )}
      {(open || t.state === 'failed' || t.state === 'review') && (t.output || t.log.length > 0) && (
        <div className="factory-output">
          {t.log.map((d, i) => <div key={i} className={`did ${d.ok ? '' : 'failed'}`}>{d.ok ? <Check size={13} /> : <X size={13} />} {d.summary}{d.error ? `: ${d.error}` : ''}{d.link && <a href={d.link} aria-label="Open">↗</a>}</div>)}
          {t.output && <div className="factory-result">{t.output}</div>}
        </div>
      )}
      {!open && t.state === 'done' && t.output && <div className="factory-peek muted small" onClick={() => setOpen(true)}>{t.output.slice(0, 160)}{t.output.length > 160 ? '…' : ''}</div>}
    </div>
  );
}
