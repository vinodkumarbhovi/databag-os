'use client';

import { ChevronLeft, ChevronRight, Link2, Plus, Video } from 'lucide-react';
import { BookingLinks } from './BookingLinks';
import { useCallback, useEffect, useState } from 'react';
import { rpc } from '@/lib/client';
import { Field, Modal, useToast } from './ui';

type Ev = { id: string; owner_id: string; title: string; starts_at: number; ends_at: number; location: string; notes: string; attendees: string[]; meet_room: string | null };
type Form = { id?: string; title: string; date: string; start: string; end: string; location: string; notes: string; attendees: string; addMeet: boolean; meet_room?: string | null };

const DAY = 864e5;
const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function CalendarApp() {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [events, setEvents] = useState<Ev[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [links, setLinks] = useState(false);
  const { toast, notify, attempt } = useToast();

  // The grid always shows six weeks, starting on a Monday.
  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const from = gridStart.getTime();

  const load = useCallback(() => rpc<Ev[]>('calendar.list', { from, to: from + 42 * DAY }).then(setEvents).catch(() => {}), [from]);
  useEffect(() => { load(); }, [load]);

  const newOn = (d: Date) => setForm({ title: '', date: dateStr(d), start: '10:00', end: '11:00', location: '', notes: '', attendees: '', addMeet: false });
  const edit = (e: Ev) => {
    const s = new Date(e.starts_at);
    setForm({ id: e.id, title: e.title, date: dateStr(s), start: timeStr(s), end: timeStr(new Date(e.ends_at)), location: e.location, notes: e.notes, attendees: e.attendees.join(', '), addMeet: false, meet_room: e.meet_room });
  };

  const save = async () => {
    if (!form) return;
    const ok = await attempt(() => rpc('calendar.save', {
      id: form.id, title: form.title, location: form.location, notes: form.notes, addMeet: form.addMeet,
      starts_at: new Date(`${form.date}T${form.start}`).getTime(), ends_at: new Date(`${form.date}T${form.end}`).getTime(),
      attendees: form.attendees.split(/[,;\s]+/).filter(Boolean),
    }), form.id ? 'Saved.' : 'Event created.');
    if (ok) { setForm(null); load(); }
  };
  const remove = async () => {
    if (form?.id && (await attempt(() => rpc('calendar.remove', { id: form.id }), 'Event deleted.'))) { setForm(null); load(); }
  };

  const today = dateStr(new Date());
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form!, [k]: e.target.value });

  return (
    <div className="app">
      <div className="bar">
        <h1>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h1>
        <button className="btn icon" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
        <button className="btn" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
        <button className="btn icon" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
        <button className="btn" onClick={() => setLinks(true)}><Link2 size={15} /> Booking links</button>
        <button className="btn primary" onClick={() => newOn(new Date())}><Plus size={15} /> New event</button>
      </div>
      <div className="cal-head">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}</div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="cal">
          {days.map((d) => {
            const key = dateStr(d);
            return (
              <div key={key} className={`cal-day ${d.getMonth() === month.getMonth() ? '' : 'other'} ${key === today ? 'today' : ''}`} onClick={() => newOn(d)}>
                <div className="n">{d.getDate()}</div>
                {events.filter((e) => dateStr(new Date(e.starts_at)) === key).map((e) => (
                  <button key={e.id} className="cal-ev" title={e.title} onClick={(c) => { c.stopPropagation(); edit(e); }}>
                    {timeStr(new Date(e.starts_at))} {e.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {form && (
        <Modal title={form.id ? 'Event' : 'New event'} onClose={() => setForm(null)}>
          <Field label="Title"><input className="input" autoFocus value={form.title} onChange={set('title')} /></Field>
          <div className="two">
            <Field label="Date"><input className="input" type="date" value={form.date} onChange={set('date')} /></Field>
            <div className="two">
              <Field label="From"><input className="input" type="time" value={form.start} onChange={set('start')} /></Field>
              <Field label="To"><input className="input" type="time" value={form.end} onChange={set('end')} /></Field>
            </div>
          </div>
          <Field label="Guests (email addresses, separated by commas)"><input className="input" value={form.attendees} onChange={set('attendees')} /></Field>
          <Field label="Where"><input className="input" value={form.location} onChange={set('location')} /></Field>
          <Field label="Notes"><textarea className="input" value={form.notes} onChange={set('notes')} /></Field>
          {form.meet_room ? (
            <a className="btn" href={`/meet?room=${form.meet_room}`} style={{ marginBottom: 14 }}><Video size={15} /> Join video call</a>
          ) : !form.id && (
            <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.addMeet} onChange={(e) => setForm({ ...form, addMeet: e.target.checked })} /> Add a video call
            </label>
          )}
          <div className="modal-foot">
            {form.id && <button className="btn" onClick={remove}>Delete</button>}
            <button className="btn primary" onClick={save}>{form.id ? 'Save' : 'Create and invite'}</button>
          </div>
        </Modal>
      )}
      {links && <BookingLinks onClose={() => setLinks(false)} notify={notify} />}
      {toast}
    </div>
  );
}
