'use client';

import { Bot, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { Job } from '@/lib/catalog';
import { call, rpc, when } from '@/lib/client';
import type { Slot, Todo } from '@/lib/today';
import { AppIcon } from './AppIcon';
import { AgentChat } from './AgentChat';
import { useToast } from './ui';

type Machine = { ai: { ok: boolean; model: string; installed: boolean }; memory: { appMb: number; usedGb: number; totalGb: number }; disk: { usedGb: number; totalGb: number } | null; backup: { at: number } | null };
type Event = { id: string; app: string; summary: string; created_at: number };

export function HomeView({ name, shortcuts }: { name: string; shortcuts: Job[] }) {
  const [data, setData] = useState<{ todos: Todo[]; schedule: Slot[]; machine: Machine } | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string; description: string }[]>([]);
  const [stats, setStats] = useState<Record<string, { waiting: number; failed: number; total: number }>>({});
  const [agent, setAgent] = useState<string>('assistant');
  const [busy, setBusy] = useState('');
  const { toast, attempt } = useToast();
  const router = useRouter();

  const load = useCallback(() => {
    call<{ todos: Todo[]; schedule: Slot[]; machine: Machine }>('/api/today').then(setData).catch(() => {});
    call<{ events: Event[] }>('/api/events').then((d) => setEvents(d.events.slice(0, 6))).catch(() => {});
    rpc<{ agents: { id: string; name: string; description: string }[] }>('agents.list').then((d) => setAgents(d.agents)).catch(() => {});
    rpc<{ stats: { agent: string; waiting: number; failed: number; total: number }[] }>('activity.summary').then((d) => setStats(Object.fromEntries(d.stats.map((x) => [x.agent, x])))).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const act = async (t: Todo) => {
    if (t.href) return router.push(t.href);
    setBusy(t.id);
    if (await attempt(() => rpc(t.rpc!.fn, t.rpc!.args), t.button === 'Send reminder' ? 'Reminder sent.' : 'Done.')) load();
    setBusy('');
  };
  const m = data?.machine;

  return (
    <div className="page today">
      <header>
        <div className="mono muted" suppressHydrationWarning>{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1 className="today-title" suppressHydrationWarning>{greeting}, {name.split(' ')[0]}</h1>
      </header>

      <section className="agent-desk">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Your agents</h2>
          <span className="row" style={{ gap: 6 }}>
            <Link href="/activity" className="btn ghost"><ShieldCheck size={14} /> Activity{Object.values(stats).reduce((n, x) => n + (x.waiting || 0), 0) ? ` · ${Object.values(stats).reduce((n, x) => n + (x.waiting || 0), 0)} waiting` : ''}</Link>
            <Link href="/agents" className="btn ghost"><Plus size={14} /> Build an agent</Link>
          </span>
        </div>
        <div className="agent-tabs" role="tablist" aria-label="Agents">
          {[{ id: 'assistant', name: 'Assistant', description: 'Works across every app' }, ...agents].map((a) => (
            <button key={a.id} role="tab" aria-selected={agent === a.id} className={`agent-tab ${agent === a.id ? 'on' : ''}`} onClick={() => setAgent(a.id)} title={a.description}>
              {a.id === 'assistant' ? <Sparkles size={14} /> : <Bot size={14} />}
              <span>{a.name}</span>
              {!!stats[a.id]?.waiting && <span className="badge warn">{stats[a.id].waiting}</span>}
            </button>
          ))}
        </div>
        <div className="agent-desk-body">
          <div className="muted small" style={{ marginBottom: 8 }}>
            {agent === 'assistant' ? 'The assistant works in every app for you. ' : `${agents.find((a) => a.id === agent)?.description ?? ''} `}
            Each agent has its own conversation, memory and permissions; nothing is shared between them.
          </div>
          <AgentChat key={agent} agentId={agent === 'assistant' ? undefined : agent} name={agent === 'assistant' ? 'the assistant' : agents.find((a) => a.id === agent)?.name ?? 'the agent'}
            placeholder={agent === 'assistant' ? 'Tell the assistant what to do, e.g. “schedule 30 minutes with Ben tomorrow at 10”' : undefined} />
        </div>
        {shortcuts.length > 0 && (
          <div className="chips">
            {shortcuts.map((j) => <Link key={j.id} href={`/${j.app}`} className="chip">{j.label}</Link>)}
          </div>
        )}
      </section>

      <div className="today-grid">
        <section>
          <h2>Needs you <span className="muted" style={{ fontWeight: 400 }}>{data?.todos.length ?? ''}</span></h2>
          <div className="panel">
            {data?.todos.map((t) => (
              <div key={t.id} className="panel-row">
                <div className="panel-icon"><AppIcon id={t.app} size={16} /></div>
                <div className="grow">
                  <div style={{ fontWeight: 500 }}>{t.title}</div>
                  <div className="muted small">{t.sub}</div>
                </div>
                <button className="btn" disabled={busy === t.id} onClick={() => act(t)}>{t.button}</button>
              </div>
            ))}
            {data && data.todos.length === 0 && <div className="panel-empty">Nothing needs you right now.</div>}
            {!data && <div className="panel-empty">Loading…</div>}
          </div>
        </section>
        <section>
          <h2>Today’s schedule</h2>
          <div className="panel">
            {data?.schedule.map((s) => (
              <div key={s.id} className="panel-row">
                <div className="mono muted" style={{ width: 44, flex: 'none' }}>{s.time}</div>
                <div className="grow">
                  <div style={{ fontWeight: 500 }}>{s.title}</div>
                  <div className="muted small">{s.sub}</div>
                </div>
                {s.join && <Link className="btn soft" href={s.join}>Join</Link>}
              </div>
            ))}
            {data && data.schedule.length === 0 && <div className="panel-empty">No meetings today.</div>}
            <Link href="/calendar" className="panel-link">Open calendar</Link>
          </div>
        </section>
      </div>

      {events.length > 0 && (
        <section>
          <h2>Recent activity</h2>
          <div className="panel">
            {events.map((e) => (
              <div key={e.id} className="panel-row compact">
                <AppIcon id={e.app} size={15} />
                <span className="grow">{e.summary}</span>
                <span className="mono muted">{when(e.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="machine-strip mono">
        <span style={{ color: 'var(--text)' }}>This machine</span>
        <span>{!m ? 'Checking…' : m.ai.ok && m.ai.installed ? 'Local AI model ready' : 'Local AI model not running'}</span>
        {m && <span>Memory {m.memory.usedGb} of {m.memory.totalGb} GB</span>}
        {m?.disk && <span>Storage {m.disk.usedGb} of {m.disk.totalGb} GB</span>}
        {m && <span>{m.backup ? `Backed up ${when(m.backup.at)}` : 'Not backed up yet'}</span>}
        <Link href="/settings" className="strip-link">Details</Link>
      </section>
      {toast}
    </div>
  );
}
