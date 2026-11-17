'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { Job } from '@/lib/catalog';
import { call, rpc, when } from '@/lib/client';
import type { Slot, Todo } from '@/lib/today';
import { AppIcon } from './AppIcon';
import { ask } from './agentBus';
import { MicButton } from './Dictation';
import { useToast } from './ui';

type Machine = { ai: { ok: boolean; model: string; installed: boolean }; memory: { appMb: number; usedGb: number; totalGb: number }; disk: { usedGb: number; totalGb: number } | null; backup: { at: number } | null };
type Event = { id: string; app: string; summary: string; created_at: number };

export function HomeView({ name, shortcuts }: { name: string; shortcuts: Job[] }) {
  const [data, setData] = useState<{ todos: Todo[]; schedule: Slot[]; machine: Machine } | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState('');
  const { toast, notify, attempt } = useToast();
  const router = useRouter();

  const load = useCallback(() => {
    call<{ todos: Todo[]; schedule: Slot[]; machine: Machine }>('/api/today').then(setData).catch(() => {});
    call<{ events: Event[] }>('/api/events').then((d) => setEvents(d.events.slice(0, 6))).catch(() => {});
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

      <section>
        <form className="ask-box" onSubmit={(e) => { e.preventDefault(); ask(question); setQuestion(''); }}>
          <Sparkles size={18} color="var(--accent)" />
          <input aria-label="Tell the agent what to do" placeholder="Tell the agent what to do, e.g. “schedule 30 minutes with Ben tomorrow at 10”" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <MicButton label="Speak to the agent" className="btn icon ghost" onText={(t) => ask(t)} onError={notify} />
          <button className="btn primary">Ask</button>
        </form>
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
