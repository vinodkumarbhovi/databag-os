import fs from 'node:fs';
import os from 'node:os';
import { aiHealth } from './ai.ts';
import type { User } from './auth.ts';
import { listBackups } from './backup.ts';
import { HOME, loadConfig } from './config.ts';
import { all, get } from './db.ts';
import { unreadCounts } from './mail/store.ts';

/**
 * The home screen's "Needs you" list and today's schedule, gathered from every
 * installed app. Each item says which app it came from and what the button does.
 */
export type Todo = { id: string; app: string; title: string; sub: string; button: string; href?: string; rpc?: { fn: string; args: unknown } };
export type Slot = { id: string; time: string; title: string; sub: string; join?: string };

const fmtMoney = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: loadConfig().currency }).format(n);
const daysAgo = (ts: number) => Math.max(0, Math.floor((Date.now() - ts) / 864e5));
const dayName = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function needsYou(u: User): Todo[] {
  const apps = loadConfig().apps;
  const out: Todo[] = [];
  const email = u.email.toLowerCase();

  if (apps.includes('accounting')) {
    const late = all<{ id: string; number: string; customer_name: string; customer_email: string; items: string; vat_rate: number; due_at: number; reminded_at: number | null }>(
      "SELECT id, number, customer_name, customer_email, items, vat_rate, due_at, reminded_at FROM acc_invoices WHERE kind = 'invoice' AND status = 'sent' AND due_at < ? ORDER BY due_at LIMIT 3", Date.now());
    for (const i of late) {
      const net = (JSON.parse(i.items) as { qty: number; price: number }[]).reduce((s, x) => s + x.qty * x.price, 0);
      const remindedToday = i.reminded_at && Date.now() - i.reminded_at < 864e5;
      out.push({
        id: `inv-${i.id}`, app: 'accounting', title: `Invoice ${i.number} to ${i.customer_name} is ${daysAgo(i.due_at)} days overdue`,
        sub: `${fmtMoney(net * (1 + i.vat_rate / 100))} · was due ${dayName(i.due_at)}${i.reminded_at ? ` · reminded ${dayName(i.reminded_at)}` : ''}`,
        ...(i.customer_email && !remindedToday ? { button: 'Send reminder', rpc: { fn: 'acc.remind', args: { id: i.id } } } : { button: 'Open', href: '/accounting' }),
      });
    }
  }
  if (apps.includes('mail')) {
    const n = unreadCounts(u.id).inbox ?? 0;
    if (n) {
      const oldest = get<{ from_name: string; from_addr: string; created_at: number }>("SELECT from_name, from_addr, created_at FROM mail_messages WHERE owner_id = ? AND folder = 'inbox' AND is_read = 0 ORDER BY created_at LIMIT 1", u.id)!;
      out.push({ id: 'mail', app: 'mail', title: `${n} unread email${n === 1 ? '' : 's'}`, sub: `Oldest from ${oldest.from_name || oldest.from_addr}, ${dayName(oldest.created_at)}`, button: 'Open Mail', href: '/mail' });
    }
  }
  if (apps.includes('sign')) {
    for (const d of all<{ token: string; name: string; owner: string }>(
      "SELECT s.token, d.name, u.name AS owner FROM sign_signers s JOIN sign_docs d ON d.id = s.doc_id JOIN users u ON u.id = d.owner_id WHERE s.email = ? AND s.signed_at IS NULL AND d.status = 'sent' LIMIT 3", email))
      out.push({ id: `sign-${d.token}`, app: 'sign', title: `${d.owner} asked you to sign "${d.name}"`, sub: 'Read it and type your name to sign', button: 'Sign', href: `/sign/${d.token}` });
    for (const d of all<{ id: string; name: string; waiting: number; created_at: number }>(
      "SELECT d.id, d.name, d.created_at, COUNT(s.id) AS waiting FROM sign_docs d JOIN sign_signers s ON s.doc_id = d.id AND s.signed_at IS NULL WHERE d.owner_id = ? AND d.status = 'sent' GROUP BY d.id ORDER BY d.created_at LIMIT 2", u.id))
      out.push({ id: `signwait-${d.id}`, app: 'sign', title: `"${d.name}" is waiting for ${d.waiting} signature${d.waiting === 1 ? '' : 's'}`, sub: `Sent ${dayName(d.created_at)}`, button: 'Open Sign', href: '/sign' });
  }
  if (apps.includes('projects')) {
    const due = all<{ title: string; due_at: number }>("SELECT title, due_at FROM proj_tasks WHERE assignee_id = ? AND status != 'done' AND due_at IS NOT NULL AND due_at < ? ORDER BY due_at", u.id, Date.now() + 864e5);
    if (due.length) out.push({ id: 'tasks', app: 'projects', title: due.length === 1 ? `Task due: ${due[0].title}` : `${due.length} of your tasks are due`, sub: due[0].due_at < Date.now() ? `Due ${dayName(due[0].due_at)}` : 'Due today', button: 'Open Projects', href: '/projects' });
  }
  if (apps.includes('tax')) {
    // VAT returns are usually due within a month or so of the quarter ending.
    const d = new Date();
    const qStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
    const prev = new Date(qStart.getFullYear(), qStart.getMonth() - 3, 1);
    const period = `${prev.getFullYear()}-Q${Math.floor(prev.getMonth() / 3) + 1}`;
    const days = Math.round((Date.now() - qStart.getTime()) / 864e5);
    const filed = get('SELECT 1 FROM tax_returns WHERE period = ?', period);
    const any = get<{ n: number }>("SELECT COUNT(*) AS n FROM acc_invoices WHERE kind = 'invoice' AND status != 'draft' AND issued_at >= ? AND issued_at < ?", prev.getTime(), qStart.getTime())!.n;
    if (!filed && any && days <= 45) out.push({ id: 'tax', app: 'tax', title: `VAT return for ${period.replace(/(\d+)-(Q\d)/, '$2 $1')} is not marked as filed`, sub: 'The figures are ready to review', button: 'Review', href: '/tax' });
  }
  return out;
}

export function schedule(u: User): Slot[] {
  if (!loadConfig().apps.includes('calendar')) return [];
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = start.getTime() + 864e5;
  return all<{ id: string; title: string; starts_at: number; ends_at: number; location: string; attendees: string; meet_room: string | null; owner_id: string }>(
    'SELECT * FROM cal_events WHERE starts_at < ? AND ends_at > ? AND (owner_id = ? OR attendees LIKE ?) ORDER BY starts_at', end, start.getTime(), u.id, `%"${u.email.toLowerCase()}"%`,
  ).map((e) => {
    const people = (JSON.parse(e.attendees) as string[]).filter((a) => a !== u.email.toLowerCase());
    return {
      id: e.id, time: new Date(e.starts_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), title: e.title,
      sub: [people.length ? `With ${people.slice(0, 2).join(', ')}${people.length > 2 ? ` and ${people.length - 2} more` : ''}` : '', e.location].filter(Boolean).join(' · ') || 'Just you',
      ...(e.meet_room ? { join: `/meet?room=${e.meet_room}` } : {}),
    };
  });
}

/** How this machine is doing: AI, memory, disk and the last backup. */
export async function machine() {
  const disk = (() => { try { const s = fs.statfsSync(HOME); return { usedGb: Math.round(((s.blocks - s.bavail) * s.bsize) / 1e9), totalGb: Math.round((s.blocks * s.bsize) / 1e9) }; } catch { return null; } })();
  const last = listBackups()[0];
  return {
    ai: await aiHealth(),
    memory: { appMb: Math.round(process.memoryUsage.rss() / 1048576), usedGb: Math.round(((os.totalmem() - os.freemem()) / 1073741824) * 10) / 10, totalGb: Math.round(os.totalmem() / 1073741824) },
    disk,
    backup: last ? { at: last.created_at, bytes: last.bytes } : null,
  };
}
