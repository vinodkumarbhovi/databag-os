import crypto from 'node:crypto';
import { loadConfig } from '../config.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { sendMail } from '../mail/store.ts';
import { type Handlers, need } from '../rpc.ts';
import { publicUrl } from '../runtime.ts';

type Row = { id: string; owner_id: string; title: string; starts_at: number; ends_at: number; location: string; notes: string; attendees: string; meet_room: string | null };
const parse = (r: Row) => ({ ...r, attendees: JSON.parse(r.attendees) as string[] });

export const calendar: Handlers = {
  /** Events in a time range that the user owns or is invited to. */
  'calendar.list': (u, { from, to }: { from: number; to: number }) =>
    all<Row>(
      'SELECT * FROM cal_events WHERE starts_at < ? AND ends_at > ? AND (owner_id = ? OR attendees LIKE ?) ORDER BY starts_at',
      to, from, u.id, `%"${u.email.toLowerCase()}"%`,
    ).map(parse),

  /** Create or update an event. New events email an invitation to every attendee. */
  'calendar.save': async (u, e: { id?: string; title: string; starts_at: number; ends_at: number; location?: string; notes?: string; attendees?: string[]; addMeet?: boolean }) => {
    need(e.title?.trim(), 'Give the event a title.');
    need(e.ends_at > e.starts_at, 'The event must end after it starts.');
    const attendees = [...new Set((e.attendees ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))];
    if (e.id) {
      const existing = get<Row>('SELECT * FROM cal_events WHERE id = ?', e.id);
      need(existing && existing.owner_id === u.id, 'Only the organiser can change this event.');
      run('UPDATE cal_events SET title = ?, starts_at = ?, ends_at = ?, location = ?, notes = ?, attendees = ? WHERE id = ?',
        e.title.trim(), e.starts_at, e.ends_at, e.location ?? '', e.notes ?? '', JSON.stringify(attendees), e.id);
      return { id: e.id };
    }
    const id = crypto.randomUUID();
    let room: string | null = null;
    if (e.addMeet) {
      room = crypto.randomUUID();
      run('INSERT INTO meet_rooms (id, title, host_id, created_at) VALUES (?, ?, ?, ?)', room, e.title.trim(), u.id, Date.now());
    }
    run('INSERT INTO cal_events (id, owner_id, title, starts_at, ends_at, location, notes, attendees, meet_room, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, u.id, e.title.trim(), e.starts_at, e.ends_at, e.location ?? '', e.notes ?? '', JSON.stringify(attendees), room, Date.now());
    emit({ type: 'calendar.created', app: 'calendar', userId: u.id, summary: `You scheduled "${e.title.trim()}"`, payload: { eventId: id } });

    const guests = attendees.filter((a) => a !== u.email.toLowerCase());
    if (guests.length) {
      const { host, port } = loadConfig();
      const when = new Date(e.starts_at).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' });
      const lines = [`${u.name} invited you to: ${e.title.trim()}`, '', `When: ${when}`];
      if (e.location) lines.push(`Where: ${e.location}`);
      if (room) lines.push(`Video call: ${publicUrl(host, port)}/meet?room=${room}`);
      if (e.notes) lines.push('', e.notes);
      await sendMail(u, { to: guests, subject: `Invitation: ${e.title.trim()}`, body: lines.join('\n') });
    }
    return { id };
  },

  'calendar.remove': (u, { id }: { id: string }) => {
    const existing = get<Row>('SELECT * FROM cal_events WHERE id = ?', id);
    need(existing && existing.owner_id === u.id, 'Only the organiser can delete this event.');
    run('DELETE FROM cal_events WHERE id = ?', id);
  },
};
