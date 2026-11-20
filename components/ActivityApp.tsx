'use client';

import { AlertTriangle, Bot, Check, ExternalLink, KeyRound, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { rpc, when } from '@/lib/client';
import { useToast } from './ui';

type Row = {
  id: string; agent_id: string | null; agent_name: string; user_name: string | null; tool: string; app: string; risk: string; summary: string;
  status: 'done' | 'failed' | 'waiting' | 'approved' | 'declined'; detail: string; link: string | null; decided_by_name: string | null; decided_at: number | null; created_at: number;
};
type Stat = { agent: string; name: string; total: number; failed: number; waiting: number; last: number };
const LABEL: Record<Row['status'], string> = { done: 'Done', failed: 'Failed', waiting: 'Waiting for OK', approved: 'Approved', declined: 'Declined' };
const RISK: Record<string, string> = { read: 'looked something up', change: 'changed data', send: 'reaches people or opens access' };

/** A live view of everything agents do, with the approvals they are waiting for. */
export function ActivityApp() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [stats, setStats] = useState<Stat[]>([]);
  const [agent, setAgent] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const { toast, attempt } = useToast();

  const load = useCallback(async () => {
    const [list, sum] = await Promise.all([
      rpc<Row[]>('activity.list', { agent, status }).catch(() => null),
      rpc<{ stats: Stat[] }>('activity.summary').catch(() => null),
    ]);
    if (list) setRows(list);
    if (sum) setStats(sum.stats);
  }, [agent, status]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const decide = async (r: Row, approve: boolean) => {
    setBusy(r.id);
    await attempt(() => rpc('activity.decide', { id: r.id, approve }), approve ? 'Approved. The agent carries on.' : 'Declined.');
    setBusy('');
    load();
  };
  const waiting = (rows ?? []).filter((r) => r.status === 'waiting');

  return (
    <div className="app">
      <div className="bar">
        <select className="tool-select" aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">All agents</option>
          {stats.map((s) => <option key={s.agent} value={s.agent}>{s.name}</option>)}
        </select>
        <select className="tool-select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Everything</option>
          {Object.entries(LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="grow-gap" />
        <span className="muted small">Updates every few seconds</span>
      </div>
      <div className="body stack">
        <div className="choice-grid">
          {stats.map((s) => (
            <button key={s.agent} type="button" className={`choice ${agent === s.agent ? 'on' : ''}`} onClick={() => setAgent(agent === s.agent ? '' : s.agent)}>
              <strong className="row" style={{ gap: 6 }}>{s.agent === 'assistant' ? <Sparkles size={13} /> : <Bot size={13} />} {s.name}</strong>
              <span>{s.total} actions this week{s.failed ? ` · ${s.failed} failed` : ''}{s.waiting ? ` · ${s.waiting} waiting` : ''} · last {when(s.last)}</span>
            </button>
          ))}
          {stats.length === 0 && <div className="muted">No agent activity yet. Ask an agent something on Today, or run a Value Factory.</div>}
        </div>

        {waiting.length > 0 && (
          <section>
            <h2 className="row" style={{ gap: 8 }}><ShieldCheck size={16} /> Waiting for approval ({waiting.length})</h2>
            <div className="stack" style={{ gap: 8 }}>
              {waiting.map((r) => (
                <div key={r.id} className="approve">
                  <div className="approve-head">{r.tool === 'request_access' ? <><KeyRound size={13} /> Access request</> : r.risk === 'send' ? 'Goes to other people' : 'Needs your OK'} · {r.agent_name}{r.user_name ? ` for ${r.user_name}` : ''} · {when(r.created_at)}</div>
                  <div>{r.summary}</div>
                  <div className="approve-buttons">
                    <button className="btn" disabled={busy === r.id} onClick={() => decide(r, false)}><X size={14} /> Decline</button>
                    <button className="btn primary" disabled={busy === r.id} onClick={() => decide(r, true)}>{busy === r.id ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2>Everything agents did</h2>
          <div className="panel">
            {rows === null && <div className="panel-empty"><Loader2 size={14} className="spin" /> Loading…</div>}
            {rows?.length === 0 && <div className="panel-empty">Nothing here yet.</div>}
            {rows?.map((r) => (
              <div key={r.id} className="activity-row">
                <span className="mono muted small">{when(r.created_at)}</span>
                <span className="row" style={{ gap: 6 }}>{r.agent_id ? <Bot size={13} /> : <Sparkles size={13} />} {r.agent_name}</span>
                <span>
                  {r.summary}
                  <div className="muted small">{r.tool} · {RISK[r.risk] ?? r.risk}{r.user_name ? ` · for ${r.user_name}` : ''}{r.decided_by_name ? ` · ${r.status} by ${r.decided_by_name}` : ''}</div>
                  {r.status === 'failed' && r.detail && <div className="small error-text"><AlertTriangle size={11} /> {r.detail}</div>}
                </span>
                <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <span className={`badge ${r.status === 'done' || r.status === 'approved' ? 'good' : r.status === 'waiting' ? 'info' : r.status === 'failed' || r.status === 'declined' ? 'warn' : ''}`}>{LABEL[r.status]}</span>
                  {r.link && <a href={r.link} aria-label="Open"><ExternalLink size={13} /></a>}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
      {toast}
    </div>
  );
}
