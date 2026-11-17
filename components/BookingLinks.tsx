'use client';

import { Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { rpc } from '@/lib/client';
import { Field, Modal } from './ui';

type Page = { id?: string; slug: string; title: string; description: string; minutes: number; days: number[]; start_min: number; end_min: number; buffer_min: number; notice_hours: number; ahead_days: number; add_meet: number; active: number; url?: string; upcoming?: number };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const BLANK: Page = { slug: '', title: 'Intro call', description: '', minutes: 30, days: [1, 2, 3, 4, 5], start_min: 540, end_min: 1020, buffer_min: 10, notice_hours: 4, ahead_days: 30, add_meet: 1, active: 1 };

/** Booking links: list, create and edit the pages people use to book time with you. */
export function BookingLinks({ onClose, notify }: { onClose: () => void; notify: (t: string) => void }) {
  const [pages, setPages] = useState<Page[]>([]);
  const [edit, setEdit] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => rpc<Page[]>('booking.list').then(setPages).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setError('');
    try { await rpc('booking.save', edit); setEdit(null); load(); notify('Booking page saved.'); } catch (e) { setError((e as Error).message); }
  };
  const copy = (url: string) => navigator.clipboard.writeText(location.origin + url).then(() => notify('Link copied.'), () => notify(location.origin + url));

  if (edit)
    return (
      <Modal title={edit.id ? 'Edit booking page' : 'New booking page'} wide onClose={() => setEdit(null)}>
        <div className="two">
          <Field label="Title"><input className="input" autoFocus value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="Link name"><div className="split"><span className="suffix" style={{ borderRadius: '9px 0 0 9px', borderLeft: '1px solid var(--border-strong)', borderRight: 0 }}>/book/</span><input className="input" style={{ borderRadius: '0 9px 9px 0' }} placeholder="intro-call" value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} /></div></Field>
        </div>
        <Field label="What is it about? (shown to visitors)"><textarea className="input" style={{ height: 60, padding: 10 }} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
        <span className="label">Days</span>
        <div className="chips" style={{ margin: '0 0 14px' }}>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} type="button" className={`chip ${edit.days.includes(d) ? 'on' : ''}`} aria-pressed={edit.days.includes(d)} onClick={() => setEdit({ ...edit, days: edit.days.includes(d) ? edit.days.filter((x) => x !== d) : [...edit.days, d] })}>{DAYS[d]}</button>)}
        </div>
        <div className="two">
          <Field label="From"><input className="input" type="time" value={hhmm(edit.start_min)} onChange={(e) => setEdit({ ...edit, start_min: mins(e.target.value) })} /></Field>
          <Field label="Until"><input className="input" type="time" value={hhmm(edit.end_min)} onChange={(e) => setEdit({ ...edit, end_min: mins(e.target.value) })} /></Field>
          <Field label="Meeting length">
            <select className="input" value={edit.minutes} onChange={(e) => setEdit({ ...edit, minutes: Number(e.target.value) })}>{[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select>
          </Field>
          <Field label="Break between meetings (minutes)"><input className="input" type="number" min={0} max={120} value={edit.buffer_min} onChange={(e) => setEdit({ ...edit, buffer_min: Number(e.target.value) })} /></Field>
          <Field label="Earliest booking (hours from now)"><input className="input" type="number" min={0} max={336} value={edit.notice_hours} onChange={(e) => setEdit({ ...edit, notice_hours: Number(e.target.value) })} /></Field>
          <Field label="How far ahead (days)"><input className="input" type="number" min={1} max={180} value={edit.ahead_days} onChange={(e) => setEdit({ ...edit, ahead_days: Number(e.target.value) })} /></Field>
        </div>
        <label className="sign-agree" style={{ marginBottom: 8 }}><input type="checkbox" checked={!!edit.add_meet} onChange={(e) => setEdit({ ...edit, add_meet: e.target.checked ? 1 : 0 })} /> Add a video call link to each booking</label>
        <label className="sign-agree"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} /> Page is open for bookings</label>
        <p className="muted small" style={{ marginTop: 10 }}>Times already taken in your calendar are hidden automatically. Hours use this Mac’s time zone; visitors see times in theirs.</p>
        {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        <div className="modal-foot"><button className="btn primary" onClick={save}>Save</button></div>
      </Modal>
    );

  return (
    <Modal title="Booking links" wide onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>Share a link and people pick a free time with you. Each booking lands in your calendar and the guest gets an invitation by email.</p>
      {error && <div className="error field">{error}</div>}
      {pages.length === 0 && <div className="panel-empty">No booking pages yet.</div>}
      {pages.map((p) => (
        <div key={p.id} className="row" style={{ opacity: p.active ? 1 : 0.55 }}>
          <div className="grow">
            <strong>{p.title}</strong>
            <div className="muted small">{p.minutes} min · {p.days.map((d) => DAYS[d]).join(', ')} {hhmm(p.start_min)}–{hhmm(p.end_min)} · {p.upcoming} upcoming{p.active ? '' : ' · closed'}</div>
            <div className="mono small muted">{p.url}</div>
          </div>
          <button className="btn ghost icon" title="Copy link" aria-label={`Copy link for ${p.title}`} onClick={() => copy(p.url!)}><Copy size={15} /></button>
          <a className="btn ghost icon" title="Open page" aria-label={`Open ${p.title}`} href={p.url} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>
          <button className="btn" onClick={() => setEdit(p)}>Edit</button>
          <button className="btn ghost icon" aria-label={`Delete ${p.title}`} onClick={async () => { if (window.confirm(`Delete the booking page "${p.title}"? Meetings already booked stay in your calendar.`)) { await rpc('booking.remove', { id: p.id }); load(); } }}><Trash2 size={15} /></button>
        </div>
      ))}
      <div className="modal-foot"><button className="btn primary" onClick={() => setEdit({ ...BLANK })}><Plus size={14} /> New booking page</button></div>
    </Modal>
  );
}
