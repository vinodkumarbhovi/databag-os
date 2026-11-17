'use client';

import { Check, Clock, Video } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type Props = { slug: string; title: string; description: string; minutes: number; owner: string; company: string; meet: boolean };
const dayKey = (ts: number) => new Date(ts).toDateString();

/** What a visitor sees: free days, free times on the chosen day, then a short form. */
export function BookingPage({ slug, title, description, minutes, owner, company, meet }: Props) {
  const [slots, setSlots] = useState<number[] | null>(null);
  const [day, setDay] = useState('');
  const [pick, setPick] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', email: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);

  const load = () => fetch(`/api/book/${slug}`).then((r) => r.json()).then((d) => { setSlots(d.slots ?? []); setError(d.error ?? ''); }).catch(() => setError('Could not load free times.'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => [...new Set((slots ?? []).map(dayKey))], [slots]);
  useEffect(() => { if (!day && days.length) setDay(days[0]); }, [days, day]);
  const times = (slots ?? []).filter((s) => dayKey(s) === day);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/book/${slug}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, start: pick }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDone(pick);
    } catch (err) { setError((err as Error).message); setPick(null); load(); }
    setBusy(false);
  };

  return (
    <main className="public-page">
      <header>
        <div className="mono muted">{company}</div>
        <h1 className="serif">{title}</h1>
        <div className="muted booking-facts"><span><Clock size={14} /> {minutes} minutes with {owner}</span>{meet && <span><Video size={14} /> Video call link included</span>}</div>
        {description && <p style={{ whiteSpace: 'pre-wrap' }}>{description}</p>}
      </header>

      {done ? (
        <div className="panel pad booking-done">
          <Check size={20} color="var(--accent)" />
          <div><strong>You are booked.</strong><div className="muted">{new Date(done).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}. An invitation is on its way to {form.email}.</div></div>
        </div>
      ) : pick ? (
        <form className="panel pad" onSubmit={submit}>
          <p style={{ marginBottom: 14 }}><strong>{new Date(pick).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</strong> <button type="button" className="btn ghost" onClick={() => setPick(null)}>Change</button></p>
          <div className="form-grid">
            <label className="field"><span className="label">Your name</span><input className="input" required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span className="label">Your email</span><input className="input" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          </div>
          <label className="field"><span className="label">Anything to share before the meeting? (optional)</span><textarea className="input" style={{ height: 80, padding: 10 }} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          {error && <div className="error field">{error}</div>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Booking…' : 'Confirm booking'}</button>
        </form>
      ) : (
        <div className="panel booking-grid">
          <div className="booking-days" role="listbox" aria-label="Days with free times">
            {slots === null && <div className="panel-empty">Loading free times…</div>}
            {slots?.length === 0 && <div className="panel-empty">No free times in the coming weeks.</div>}
            {days.map((d) => (
              <button key={d} role="option" aria-selected={d === day} className={d === day ? 'on' : ''} onClick={() => setDay(d)}>
                {new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              </button>
            ))}
          </div>
          <div className="booking-times">
            {times.map((t) => <button key={t} className="chip" onClick={() => setPick(t)}>{new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</button>)}
            {error && <div className="error">{error}</div>}
          </div>
        </div>
      )}
      <p className="mono muted small">Times are shown in your time zone ({zone}).</p>
    </main>
  );
}
