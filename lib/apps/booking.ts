import crypto from 'node:crypto';
import { listUsers } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { type Handlers, need } from '../rpc.ts';
import { calendar } from './calendar.ts';

/**
 * Booking links: a public page where people outside the company pick a free time
 * with you. Free times come from the opening hours you set, minus your calendar.
 * Times are worked out in this Mac's time zone; the booking page shows them in the visitor's.
 */
type Page = {
  id: string; owner_id: string; slug: string; title: string; description: string; minutes: number; days: string;
  start_min: number; end_min: number; buffer_min: number; notice_hours: number; ahead_days: number; add_meet: number; active: number;
};
const MAX_SLOTS = 600;
const PER_DAY_LIMIT = 30;

export function slotsFor(page: Page, from = Date.now()): number[] {
  const owner = listUsers().find((u) => u.id === page.owner_id);
  if (!owner) return [];
  const days = JSON.parse(page.days) as number[];
  const step = page.minutes * 60_000;
  const buffer = page.buffer_min * 60_000;
  const earliest = from + page.notice_hours * 3_600_000;
  const until = from + page.ahead_days * 864e5;
  const busy = all<{ starts_at: number; ends_at: number }>(
    'SELECT starts_at, ends_at FROM cal_events WHERE starts_at < ? AND ends_at > ? AND (owner_id = ? OR attendees LIKE ?)',
    until + step, from, owner.id, `%"${owner.email.toLowerCase()}"%`);
  const out: number[] = [];
  const day = new Date(from); day.setHours(0, 0, 0, 0);
  for (; day.getTime() < until && out.length < MAX_SLOTS; day.setDate(day.getDate() + 1)) {
    if (!days.includes(day.getDay())) continue;
    for (let m = page.start_min; m + page.minutes <= page.end_min; m += page.minutes + page.buffer_min) {
      const start = new Date(day); start.setHours(0, m, 0, 0);
      const s = start.getTime(), e = s + step;
      if (s < earliest || s >= until) continue;
      if (busy.some((b) => b.starts_at < e + buffer && b.ends_at > s - buffer)) continue;
      out.push(s);
    }
  }
  return out;
}

export function publicPage(slug: string) {
  const page = get<Page>('SELECT * FROM cal_booking_pages WHERE slug = ? AND active = 1', String(slug).toLowerCase());
  if (!page || !loadConfig().apps.includes('calendar')) return null;
  const owner = listUsers().find((u) => u.id === page.owner_id);
  if (!owner) return null;
  return { page, owner: owner.name, company: loadConfig().company.name };
}

/** A visitor books a time. Creates the event, invites them by email and tells the owner. */
export async function book(slug: string, b: { start: number; name: string; email: string; note?: string }): Promise<{ start: number; end: number }> {
  const found = publicPage(slug);
  need(found, 'This booking page is not available.');
  const { page } = found;
  const name = b.name?.trim().slice(0, 100);
  const email = b.email?.trim().toLowerCase().slice(0, 200);
  need(name, 'Enter your name.');
  need(email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email address.');
  need(slotsFor(page).includes(Number(b.start)), 'That time is no longer free. Pick another one.');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  need(get<{ n: number }>('SELECT COUNT(*) AS n FROM cal_events WHERE booked_by = ? AND created_at > ?', page.id, today.getTime())!.n < PER_DAY_LIMIT, 'This page has had too many bookings today. Try again tomorrow.');
  const owner = listUsers().find((u) => u.id === page.owner_id)!;
  const start = Number(b.start), end = start + page.minutes * 60_000;
  const { id } = (await calendar['calendar.save'](owner, {
    title: `${page.title} with ${name}`, starts_at: start, ends_at: end, attendees: [owner.email, email],
    notes: [`Booked by ${name} <${email}> through your booking page.`, b.note?.trim() ? `\nTheir note:\n${b.note.trim().slice(0, 2000)}` : ''].join(''),
    addMeet: !!page.add_meet,
  })) as { id: string };
  run('UPDATE cal_events SET booked_by = ? WHERE id = ?', page.id, id);
  emit({ type: 'calendar.booked', app: 'calendar', userId: owner.id, summary: `${name} booked "${page.title}" for ${new Date(start).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`, payload: { eventId: id } });
  return { start, end };
}

const DAY_SET = (d: unknown) => [...new Set((Array.isArray(d) ? d : []).map(Number).filter((n) => n >= 0 && n <= 6))].sort();

export const booking: Handlers = {
  'booking.list': (u) => all<Page>('SELECT * FROM cal_booking_pages WHERE owner_id = ? ORDER BY created_at', u.id).map((p) => ({
    ...p, days: JSON.parse(p.days) as number[], url: `/book/${p.slug}`,
    upcoming: get<{ n: number }>('SELECT COUNT(*) AS n FROM cal_events WHERE booked_by = ? AND starts_at > ?', p.id, Date.now())!.n,
  })),

  'booking.save': (u, p: Partial<Omit<Page, 'days'>> & { days?: number[] }) => {
    const title = p.title?.trim();
    need(title, 'Give the booking page a title.');
    const slug = (p.slug ?? title).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    need(slug.length >= 3, 'The link name needs at least 3 letters or numbers.');
    const days = DAY_SET(p.days);
    need(days.length, 'Pick at least one day.');
    const minutes = Number(p.minutes), start = Number(p.start_min), end = Number(p.end_min);
    need([15, 20, 30, 45, 60, 90].includes(minutes), 'Choose a meeting length.');
    need(start >= 0 && end <= 1440 && end - start >= minutes, 'The opening hours must be at least one meeting long.');
    const clash = get<{ id: string }>('SELECT id FROM cal_booking_pages WHERE slug = ?', slug);
    need(!clash || clash.id === p.id, 'Another booking page already uses that link name.');
    const v = [slug, title.slice(0, 120), (p.description ?? '').slice(0, 1000), minutes, JSON.stringify(days), start, end,
      Math.max(0, Math.min(120, Number(p.buffer_min) || 0)), Math.max(0, Math.min(336, Number(p.notice_hours ?? 4))), Math.max(1, Math.min(180, Number(p.ahead_days) || 30)), p.add_meet === 0 ? 0 : 1, p.active === 0 ? 0 : 1];
    if (p.id) {
      need(get('SELECT 1 FROM cal_booking_pages WHERE id = ? AND owner_id = ?', p.id, u.id), 'That booking page does not exist.');
      run('UPDATE cal_booking_pages SET slug = ?, title = ?, description = ?, minutes = ?, days = ?, start_min = ?, end_min = ?, buffer_min = ?, notice_hours = ?, ahead_days = ?, add_meet = ?, active = ? WHERE id = ?', ...v, p.id);
      return { id: p.id, slug };
    }
    const id = crypto.randomUUID();
    run('INSERT INTO cal_booking_pages (slug, title, description, minutes, days, start_min, end_min, buffer_min, notice_hours, ahead_days, add_meet, active, id, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ...v, id, u.id, Date.now());
    return { id, slug };
  },

  'booking.remove': (u, { id }: { id: string }) => {
    run('DELETE FROM cal_booking_pages WHERE id = ? AND owner_id = ?', id, u.id);
  },
};
