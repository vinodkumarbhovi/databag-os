'use client';

import { Check, ExternalLink, Loader2, RotateCcw, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { call } from '@/lib/client';
import type { Pending, Turn } from '@/lib/agent/agent';
import { MicButton } from './Dictation';

type Line = { who: 'you' | 'agent'; text: string } | { who: 'did'; ok: boolean; text: string; link?: string } | { who: 'pending'; pending: Pending; state: 'open' | 'approved' | 'declined' };

/**
 * A conversation with one agent. Each agent keeps its own conversation (remembered in this
 * browser tab) and its own memory on the server; nothing is shared between agents.
 * agentId undefined = the built-in assistant that works across every app.
 */
export function AgentChat({ agentId, name, app = 'overview', placeholder, compact }: { agentId?: string; name: string; app?: string; placeholder?: string; compact?: boolean }) {
  const key = `databag-chat-${agentId ?? 'assistant'}`;
  const [log, setLog] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const conversation = useRef<string | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);

  // Each agent's thread survives switching agents and reloading the page.
  useEffect(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null'); setLog(saved?.log ?? []); conversation.current = saved?.conversation; }
    catch { setLog([]); conversation.current = undefined; }
  }, [key]);
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify({ log: log.slice(-60), conversation: conversation.current })); } catch { /* private mode */ }
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [log, key]);

  const take = (t: Turn) => {
    conversation.current = t.conversation;
    setLog((l) => [...l,
      ...t.done.map((d) => ({ who: 'did' as const, ok: d.ok, text: d.ok ? d.summary : `${d.summary}: ${d.error}`, link: d.link })),
      ...(t.reply ? [{ who: 'agent' as const, text: t.reply }] : []),
      ...(t.pending ? [{ who: 'pending' as const, pending: t.pending, state: 'open' as const }] : [])]);
    if (t.done.some((d) => d.ok)) window.dispatchEvent(new Event('databag:changed'));
  };
  const go = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { take(await call<Turn>('/api/agent', { body: { ...body, conversation: conversation.current, agent: agentId, app } })); }
    catch (err) { setLog((l) => [...l, { who: 'agent', text: (err as Error).message }]); }
    setBusy(false);
  };
  const send = (message: string) => { if (!message.trim() || busy) return; setLog((l) => [...l, { who: 'you', text: message }]); setText(''); go({ message }); };
  const decide = (p: Pending, approve: boolean) => {
    setLog((l) => l.map((x) => (x.who === 'pending' && x.pending.id === p.id ? { ...x, state: approve ? 'approved' : 'declined' } : x)));
    go({ pending: p.id, approve, edits }); setEdits({});
  };
  const reset = () => { conversation.current = undefined; setLog([]); };

  return (
    <div className={`agent-chat ${compact ? 'compact' : ''}`}>
      <div className="agent-chat-log">
        {log.length === 0 && <div className="muted small">Ask {name} to do something. It works with its own tools and memory, and asks before anything goes out.</div>}
        {log.map((l, i) => {
          if (l.who === 'pending') return (
            <div key={i} className={`approve ${l.state}`}>
              <div className="approve-head">{l.pending.risk === 'send' ? 'Needs your OK: this goes to other people or opens access' : 'Needs your OK'}</div>
              <div>{l.pending.summary}</div>
              {l.pending.preview.map((f) => (
                <label key={f.label} className="approve-field"><span className="label">{f.label}</span>
                  {f.editable && f.key && l.state === 'open'
                    ? <textarea className="input" rows={Math.min(10, f.value.split('\n').length + 1)} defaultValue={f.value} onChange={(e) => setEdits((x) => ({ ...x, [f.key!]: e.target.value }))} />
                    : <div style={{ whiteSpace: 'pre-wrap' }}>{f.value}</div>}
                </label>
              ))}
              {l.state === 'open'
                ? <div className="approve-buttons"><button className="btn" disabled={busy} onClick={() => decide(l.pending, false)}>Don’t</button><button className="btn primary" disabled={busy} onClick={() => decide(l.pending, true)}><Check size={14} /> {l.pending.risk === 'send' ? 'Approve' : 'Do it'}</button></div>
                : <div className="muted small">{l.state === 'approved' ? 'Approved' : 'Declined'}</div>}
            </div>
          );
          if (l.who === 'did') return <div key={i} className={`did ${l.ok ? '' : 'failed'}`}>{l.ok ? <Check size={13} /> : <X size={13} />}<span style={{ flex: 1 }}>{l.text}</span>{l.link && <a href={l.link} aria-label="Open"><ExternalLink size={13} /></a>}</div>;
          return <div key={i} className={`bubble ${l.who === 'you' ? 'from-user' : 'from-ai'}`} style={{ whiteSpace: 'pre-wrap' }}>{l.text}</div>;
        })}
        {busy && <div className="muted small"><Loader2 size={13} className="spin" /> {name} is working…</div>}
        <div ref={end} />
      </div>
      <form className="agent-chat-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input className="input" aria-label={`Ask ${name}`} placeholder={placeholder ?? `Ask ${name}…`} value={text} onChange={(e) => setText(e.target.value)} />
        <MicButton label={`Speak to ${name}`} className="btn icon ghost" onText={(t) => send(t)} onError={() => {}} />
        {log.length > 0 && <button type="button" className="btn ghost icon" title="New conversation" aria-label="New conversation" onClick={reset}><RotateCcw size={14} /></button>}
        <button className="btn primary" disabled={busy || !text.trim()}><Send size={14} /> Send</button>
      </form>
    </div>
  );
}
