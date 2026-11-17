import type { User } from './auth.ts';
import { loadConfig } from './config.ts';
import { all } from './db.ts';

/**
 * Search across every installed app at once. Each app only returns what the
 * person may see: their own mail, chats they belong to, files and records the company shares.
 */
export type Hit = { app: string; title: string; sub: string; href: string; at?: number };
const LIMIT = 6;

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
/** A short piece of text around the first match. */
function snippet(text: string, words: string[]): string {
  const lower = text.toLowerCase();
  const at = Math.max(0, Math.min(...words.map((w) => { const i = lower.indexOf(w); return i < 0 ? Infinity : i; })));
  if (!Number.isFinite(at)) return text.slice(0, 110);
  const start = Math.max(0, at - 40);
  return (start ? '…' : '') + text.slice(start, start + 120).trim() + (start + 120 < text.length ? '…' : '');
}

export function search(u: User, query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).map((w) => w.replace(/[%_\\]/g, '')).filter((w) => w.length >= 2).slice(0, 5);
  if (!words.length) return [];
  const apps = loadConfig().apps;
  const has = (a: string) => apps.includes(a);
  // Every word must appear in at least one of the given columns.
  const where = (cols: string[]) => ({
    sql: words.map(() => `(${cols.map((c) => `LOWER(${c}) LIKE ?`).join(' OR ')})`).join(' AND '),
    args: words.flatMap((w) => cols.map(() => `%${w}%`)),
  });
  const q = (sql: string, cols: string[], ...pre: (string | number)[]) => { const w = where(cols); return { sql: sql.replace('$W', w.sql), args: [...pre, ...w.args] }; };
  const hits: Hit[] = [];
  const add = <T,>(cond: boolean, x: { sql: string; args: (string | number)[] }, map: (r: T) => Hit) => { if (cond) hits.push(...all<T & Record<string, unknown>>(x.sql + ` LIMIT ${LIMIT}`, ...x.args).map(map)); };

  type MailRow = { id: string; subject: string; from_name: string; from_addr: string; body_text: string; created_at: number };
  add<MailRow>(has('mail'), q("SELECT id, subject, from_name, from_addr, body_text, created_at FROM mail_messages WHERE owner_id = ? AND folder != 'trash' AND $W ORDER BY created_at DESC", ['subject', 'body_text', 'from_name', 'from_addr', 'to_addrs'], u.id),
    (r) => ({ app: 'mail', title: r.subject || '(no subject)', sub: `${r.from_name || r.from_addr} · ${snippet(r.body_text, words)}`, href: `/mail?open=${r.id}`, at: r.created_at }));
  type FileRow = { id: string; kind: string; title: string; content: string; updated_at: number };
  add<FileRow>(has('docs') || has('sheets') || has('slides'), q('SELECT id, kind, title, content, updated_at FROM office_files WHERE $W ORDER BY updated_at DESC', ['title', 'content']),
    (r) => { const app = r.kind === 'doc' ? 'docs' : r.kind === 'sheet' ? 'sheets' : 'slides'; return { app, title: r.title, sub: snippet(r.kind === 'doc' ? strip(r.content) : r.content.replace(/[{}"\\[\]]+/g, ' '), words), href: `/${app}?id=${r.id}`, at: r.updated_at }; });
  add<{ name: string; size: number; created_at: number }>(has('drive'), q('SELECT name, size, created_at FROM drive_files WHERE $W ORDER BY created_at DESC', ['name']),
    (r) => ({ app: 'drive', title: r.name, sub: `${Math.max(1, Math.round(r.size / 1024))} KB`, href: `/drive`, at: r.created_at }));
  add<{ id: string; name: string; email: string; company: string }>(has('crm') || has('contacts'), q('SELECT id, name, email, company FROM crm_contacts WHERE $W ORDER BY name', ['name', 'email', 'company', 'phone', 'notes']),
    (r) => ({ app: has('contacts') ? 'contacts' : 'crm', title: r.name, sub: [r.company, r.email].filter(Boolean).join(' · '), href: has('contacts') ? '/contacts' : '/crm' }));
  add<{ title: string; stage: string; value: number }>(has('crm'), q('SELECT title, stage, value FROM crm_deals WHERE $W ORDER BY updated_at DESC', ['title']),
    (r) => ({ app: 'crm', title: r.title, sub: `Deal · ${r.stage} · ${r.value.toLocaleString('en-GB')}`, href: '/crm' }));
  add<{ number: string; kind: string; customer_name: string; status: string; issued_at: number }>(has('accounting'), q('SELECT number, kind, customer_name, status, issued_at FROM acc_invoices WHERE $W ORDER BY issued_at DESC', ['number', 'customer_name', 'customer_email', 'items']),
    (r) => ({ app: 'accounting', title: `${r.kind === 'quote' ? 'Quote' : 'Invoice'} ${r.number}`, sub: `${r.customer_name} · ${r.status}`, href: '/accounting', at: r.issued_at }));
  add<{ vendor: string; description: string; amount: number; spent_at: number }>(has('accounting'), q('SELECT vendor, description, amount, spent_at FROM acc_expenses WHERE $W ORDER BY spent_at DESC', ['vendor', 'description']),
    (r) => ({ app: 'accounting', title: `Expense: ${r.vendor}`, sub: r.description || r.amount.toLocaleString('en-GB'), href: '/accounting', at: r.spent_at }));
  add<{ title: string; project: string; status: string; updated_at: number }>(has('projects'), q('SELECT t.title, p.name AS project, t.status, t.updated_at FROM proj_tasks t JOIN proj_projects p ON p.id = t.project_id WHERE $W ORDER BY t.updated_at DESC', ['t.title', 't.notes', 'p.name']),
    (r) => ({ app: 'projects', title: r.title, sub: `${r.project} · ${r.status === 'doing' ? 'in progress' : r.status === 'todo' ? 'to do' : 'done'}`, href: '/projects', at: r.updated_at }));
  add<{ title: string; starts_at: number }>(has('calendar'), q('SELECT title, starts_at FROM cal_events WHERE (owner_id = ? OR attendees LIKE ?) AND $W ORDER BY starts_at DESC', ['title', 'location', 'notes'], u.id, `%"${u.email.toLowerCase()}"%`),
    (r) => ({ app: 'calendar', title: r.title, sub: new Date(r.starts_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }), href: '/calendar', at: r.starts_at }));
  add<{ body: string; channel_id: string; channel: string; kind: string; name: string; created_at: number }>(has('chat'), q(
    `SELECT m.body, m.channel_id, c.name AS channel, c.kind, u.name, m.created_at FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id JOIN users u ON u.id = m.user_id
     WHERE (c.kind = 'channel' OR c.members LIKE ?) AND $W ORDER BY m.created_at DESC`, ['m.body'], `%"${u.id}"%`),
    (r) => ({ app: 'chat', title: snippet(r.body, words), sub: `${r.kind === 'channel' ? `#${r.channel}` : 'Direct message'} · ${r.name}`, href: `/chat?channel=${r.channel_id}`, at: r.created_at }));
  add<{ name: string; status: string; created_at: number }>(has('sign'), q('SELECT name, status, created_at FROM sign_docs WHERE (owner_id = ? OR id IN (SELECT doc_id FROM sign_signers WHERE email = ?)) AND $W ORDER BY created_at DESC', ['name'], u.id, u.email.toLowerCase()),
    (r) => ({ app: 'sign', title: r.name, sub: r.status === 'completed' ? 'Signed by everyone' : r.status === 'sent' ? 'Waiting for signatures' : 'Not sent yet', href: '/sign', at: r.created_at }));
  return hits;
}
