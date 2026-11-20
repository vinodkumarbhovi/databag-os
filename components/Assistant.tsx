'use client';

import { Check, ExternalLink, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '@/lib/client';
import type { Done, Pending, Turn } from '@/lib/agent/agent';
import { AppIcon } from './AppIcon';
import { MicButton } from './Dictation';

export { ask } from './agentBus';

type Line =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string; done: Done[] }
  | { kind: 'pending'; pending: Pending; state: 'open' | 'approved' | 'declined' }
  | { kind: 'error'; text: string };

const NAMES: Record<string, string> = { mail: 'Mail', calendar: 'Calendar', meet: 'Meet', chat: 'Chat', docs: 'Docs', sheets: 'Sheets', slides: 'Slides', drive: 'Drive', crm: 'CRM', contacts: 'Contacts', projects: 'Projects', sign: 'Sign', accounting: 'Accounting', tax: 'Tax', linkedin: 'LinkedIn' };
const IDEAS: Record<string, string[]> = {
  overview: ['What needs me today?', 'Summarise my unread email', 'What is overdue?'],
  mail: ['Summarise my unread email', 'Reply to the latest email from Ben', 'Email Mira a short update on the pricing meeting'],
  calendar: ['What is on tomorrow?', 'Schedule 30 minutes with Ben tomorrow at 10', 'Remind me on Friday at 9 to send the VAT return'],
  meet: ['Set up a video call with Mira today at 15:00'],
  chat: ['Post in #general that the office is closed on Friday', 'Message Ben that the pricing deck is ready'],
  docs: ['Write a one-page offer letter for a new designer'], sheets: ['Which documents did I change this week?'], slides: ['Which presentations do we have?'],
  drive: ['Find the lease contract'],
  crm: ['Which deals are at the proposal stage?', 'Add a deal: website redesign for Northwind, 4000'],
  contacts: ['Add Priya Shah from Northwind Bakery, priya@northwind.example'],
  projects: ['What are my tasks?', 'Add a task for Ben to update the price list by Friday'],
  sign: ['Which documents still need signatures?'],
  accounting: ['What is overdue?', 'Invoice Northwind for 12 hours of consulting at 95', 'Send reminders for overdue invoices'],
  tax: ['How much VAT do I owe this quarter?'],
  linkedin: ['Draft a LinkedIn post about why we run our company on local AI', 'Which leads fit best and have not been contacted?', 'Start a campaign to book demos with cafés, with 3 draft posts'],
};

/** The agent panel. Opened from any app (it then works there first) or from Today (it works across everything). */
export function Assistant() {
  const path = usePathname();
  const app = path === '/' ? 'overview' : path.split('/')[1] in NAMES ? path.split('/')[1] : 'overview';
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const conversation = useRef<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const take = (turn: Turn) => {
    conversation.current = turn.conversation;
    if (turn.done.some((d) => d.ok)) window.dispatchEvent(new Event('databag:changed'));
    setLog((l) => [
      ...l,
      ...(turn.reply || turn.done.length ? [{ kind: 'agent' as const, text: turn.reply, done: turn.done }] : []),
      ...(turn.pending ? [{ kind: 'pending' as const, pending: turn.pending, state: 'open' as const }] : []),
    ]);
    if (turn.pending) setEdits(Object.fromEntries(turn.pending.preview.filter((p) => p.editable && p.key).map((p) => [p.key!, p.value])));
  };
  const send = useCallback(async (message: string) => {
    const m = message.trim();
    if (!m) return;
    setText(''); setBusy(true);
    // A new request closes any action still waiting for an answer.
    setLog((l) => [...l.map((x) => (x.kind === 'pending' && x.state === 'open' ? { ...x, state: 'declined' as const } : x)), { kind: 'user', text: m }]);
    try { take(await call<Turn>('/api/agent', { body: { conversation: conversation.current, message: m, app: appRef.current } })); }
    catch (err) { setLog((l) => [...l, { kind: 'error', text: (err as Error).message }]); }
    setBusy(false);
  }, []);
  const decide = async (p: Pending, approve: boolean) => {
    setBusy(true);
    setLog((l) => l.map((x) => (x.kind === 'pending' && x.pending.id === p.id ? { ...x, state: approve ? 'approved' : 'declined' } : x)));
    try { take(await call<Turn>('/api/agent', { body: { conversation: conversation.current, pending: p.id, approve, edits } })); }
    catch (err) { setLog((l) => [...l, { kind: 'error', text: (err as Error).message }]); }
    setBusy(false);
  };
  const reset = () => { conversation.current = undefined; setLog([]); setText(''); };

  useEffect(() => {
    const onAsk = (e: Event) => {
      setOpen(true);
      const q = (e as CustomEvent<string>).detail;
      if (q) send(q);
      setTimeout(() => input.current?.focus(), 50);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setOpen((o) => !o); setTimeout(() => input.current?.focus(), 50); }
    };
    window.addEventListener('databag:ask', onAsk);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('databag:ask', onAsk); window.removeEventListener('keydown', onKey); };
  }, [send]);
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [log, busy]);

  if (!open) return null;
  const title = app === 'overview' ? 'Agent' : `${NAMES[app]} agent`;
  return (
    <aside className="assistant" aria-label={title}>
      <div className="assistant-head">
        {app === 'overview' ? <Sparkles size={18} color="var(--accent)" /> : <span className="panel-icon" style={{ width: 28, height: 28 }}><AppIcon id={app} size={15} /></span>}
        <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{title}</div><div className="mono muted">{app === 'overview' ? 'Works across every app' : `Works in ${NAMES[app]} and every other app`} · on your machine</div></div>
        {log.length > 0 && <button className="btn ghost icon" onClick={reset} title="Start over" aria-label="Start a new conversation"><RotateCcw size={15} /></button>}
        <button className="btn ghost icon" onClick={() => setOpen(false)} aria-label="Close agent"><X size={16} /></button>
      </div>
      <div className="assistant-log" ref={scroller}>
        {log.length === 0 && (
          <>
            <p className="muted">Tell me what to do, by typing or by voice: hold the right ⌥ key, or use the microphone. I can send email, schedule meetings, add tasks, make invoices and more. Anything that reaches other people waits for your OK.</p>
            <div className="chips" style={{ marginTop: 4 }}>{(IDEAS[app] ?? IDEAS.overview).map((i) => <button key={i} className="chip" onClick={() => send(i)}>{i}</button>)}</div>
          </>
        )}
        {log.map((l, i) => {
          if (l.kind === 'user') return <div key={i} className="bubble from-user">{l.text}</div>;
          if (l.kind === 'error') return <div key={i} className="bubble from-ai error-text">{l.text}</div>;
          if (l.kind === 'agent')
            return (
              <div key={i} className="agent-turn">
                {l.done.map((d, j) => (
                  <div key={j} className={`did ${d.ok ? '' : 'failed'}`}>
                    {d.ok ? <Check size={14} /> : <X size={14} />}
                    <span className="grow">{d.summary}{d.error ? ` — ${d.error}` : ''}</span>
                    {d.ok && d.link && <Link href={d.link} title="Open" aria-label={`Open ${d.app}`}><ExternalLink size={13} /></Link>}
                  </div>
                ))}
                {l.text && <div className="bubble from-ai">{l.text}</div>}
              </div>
            );
          const p = l.pending;
          return (
            <div key={i} className={`approve ${l.state}`}>
              <div className="approve-head"><AppIcon id={p.app === 'overview' ? 'mail' : p.app} size={14} /><span>{p.risk === 'send' ? 'Needs your OK: this goes to other people' : 'Needs your OK'}</span></div>
              <strong>{p.summary}</strong>
              {p.preview.map((f) => (
                <label key={f.label} className="approve-field">
                  <span className="muted small">{f.label}</span>
                  {f.editable && l.state === 'open'
                    ? (f.key === 'subject' ? <input className="input" value={edits[f.key!] ?? ''} onChange={(e) => setEdits({ ...edits, [f.key!]: e.target.value })} />
                      : <textarea className="input" rows={Math.min(10, (edits[f.key!] ?? '').split('\n').length + 1)} value={edits[f.key!] ?? ''} onChange={(e) => setEdits({ ...edits, [f.key!]: e.target.value })} />)
                    : <span style={{ whiteSpace: 'pre-wrap' }}>{f.editable && f.key ? (edits[f.key] ?? f.value) : f.value}</span>}
                </label>
              ))}
              {l.state === 'open'
                ? <div className="approve-buttons"><button className="btn" disabled={busy} onClick={() => decide(p, false)}>Don’t</button><button className="btn primary" disabled={busy} onClick={() => decide(p, true)}><Check size={14} /> {p.risk === 'send' ? 'Send it' : 'Do it'}</button></div>
                : <div className="muted small">{l.state === 'approved' ? 'Approved' : 'Not done'}</div>}
            </div>
          );
        })}
        {busy && <div className="bubble from-ai"><Loader2 size={15} className="spin" /> Working…</div>}
      </div>
      <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); if (!busy) send(text); }}>
        <input ref={input} className="input" aria-label="Tell the agent what to do" placeholder={app === 'overview' ? 'Tell the agent what to do' : `Ask the ${NAMES[app]} agent`} value={text} onChange={(e) => setText(e.target.value)} />
        <MicButton label="Speak to the agent" onText={(t) => send(t)} onError={(m) => setLog((l) => [...l, { kind: 'error', text: m }])} />
        <button className="btn primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </aside>
  );
}
