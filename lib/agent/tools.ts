import { chat as ai } from '../ai.ts';
import { type User, listUsers } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { all, get } from '../db.ts';
import { type Folder, getMail, getThread, listMail, sendMail } from '../mail/store.ts';
import { need } from '../rpc.ts';
import { publicUrl } from '../runtime.ts';
import { search } from '../search.ts';
import { needsYou, schedule } from '../today.ts';
import { accounting } from '../apps/accounting.ts';
import { calendar } from '../apps/calendar.ts';
import { chat } from '../apps/chat.ts';
import { crm } from '../apps/crm.ts';
import { createFile } from '../apps/office.ts';
import { projects } from '../apps/projects.ts';
import { tax } from '../apps/tax.ts';

/**
 * What the agent can do in each app. Every tool says how risky it is:
 * - read: looks things up, always runs straight away;
 * - change: changes data inside databag;
 * - send: reaches other people (email, invitations, invoices, chat).
 * Settings decide which of these need the person's OK first.
 */
export type Risk = 'read' | 'change' | 'send';
type Args = Record<string, unknown>;
export type Tool = {
  name: string; app: string; risk: Risk | ((a: Args) => Risk); description: string;
  params: Record<string, { type: string; description?: string; items?: unknown; enum?: string[] }>; required?: string[];
  /** One line for the confirmation card and the activity list. */
  summary: (a: Args, u: User) => string;
  /** Extra lines shown before the person approves, such as the email text. */
  preview?: (a: Args, u: User) => { label: string; value: string; editable?: boolean; key?: string }[];
  run: (u: User, a: Args) => Promise<unknown> | unknown;
  /** Where to see the result. */
  link?: (a: Args, result: unknown) => string;
};

// ---------- Helpers the tools share ----------
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? str(v).split(/[,;]| and /).map((x) => x.trim()).filter(Boolean) : []);
const money = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: loadConfig().currency }).format(n);
const fmt = (ts: number) => new Date(ts).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** "2026-11-16 10:00", "2026-11-16T10:00", "2026-11-16" (09:00) in this computer's time zone. */
export function parseWhen(v: unknown, defaultHour = 9): number {
  const s = str(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  need(m, `"${s}" is not a date. Use YYYY-MM-DD HH:MM.`);
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : defaultHour, m[5] ? +m[5] : 0);
  need(!Number.isNaN(d.getTime()), `"${s}" is not a valid date.`);
  return d.getTime();
}

type Person = { name: string; email: string; kind: 'colleague' | 'contact' };
function people(): Person[] {
  return [
    ...listUsers().map((u) => ({ name: u.name, email: u.email.toLowerCase(), kind: 'colleague' as const })),
    ...all<{ name: string; email: string }>("SELECT name, email FROM crm_contacts WHERE email != ''").map((c) => ({ name: c.name, email: c.email.toLowerCase(), kind: 'contact' as const })),
  ];
}
/** Turn names or addresses into email addresses, or explain exactly who could not be found. */
export function resolvePeople(names: string[]): string[] {
  const everyone = people();
  return names.map((raw) => {
    const n = raw.toLowerCase().replace(/^(mr|ms|mrs|dr)\.?\s+/, '').trim();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(n)) return n;
    const exact = everyone.filter((p) => p.name.toLowerCase() === n);
    const partial = exact.length ? exact : everyone.filter((p) => p.name.toLowerCase().split(/\s+/).includes(n) || p.name.toLowerCase().startsWith(n));
    const unique = [...new Map(partial.map((p) => [p.email, p])).values()];
    need(unique.length, `Nobody called "${raw}" was found among colleagues or contacts. Ask the user for their email address.`);
    need(unique.length === 1, `"${raw}" could mean ${unique.map((p) => `${p.name} <${p.email}>`).join(' or ')}. Ask the user which one.`);
    return unique[0].email;
  });
}
const nameOf = (email: string) => people().find((p) => p.email === email)?.name ?? email;
const who = (emails: string[]) => emails.map((e) => { const n = nameOf(e); return n === e ? e : `${n} <${e}>`; }).join(', ');
const userByName = (raw: string) => { const [email] = resolvePeople([raw]); const u = listUsers().find((x) => x.email.toLowerCase() === email); need(u, `${raw} is not a colleague with a databag account.`); return u; };
const findInvoice = (ref: unknown) => {
  const r = str(ref);
  const inv = get<{ id: string; number: string; status: string; customer_name: string; customer_email: string }>(
    "SELECT id, number, status, customer_name, customer_email FROM acc_invoices WHERE id = ? OR UPPER(number) = UPPER(?) OR UPPER(number) = UPPER(?)", r, r, `INV-${r.replace(/\D/g, '').padStart(4, '0')}`);
  need(inv, `No invoice "${r}" was found. Use list_invoices to see them.`);
  return inv;
};
const findTask = (ref: unknown) => {
  const r = str(ref);
  const t = get<{ id: string; title: string }>('SELECT id, title FROM proj_tasks WHERE id = ?', r)
    ?? get<{ id: string; title: string }>("SELECT id, title FROM proj_tasks WHERE LOWER(title) LIKE ? AND status != 'done' ORDER BY updated_at DESC", `%${r.toLowerCase()}%`);
  need(t, `No open task matching "${r}". Use list_tasks to see them.`);
  return t;
};
const findDeal = (ref: unknown) => {
  const r = str(ref);
  const d = get<{ id: string; title: string }>('SELECT id, title FROM crm_deals WHERE id = ? OR LOWER(title) LIKE ? ORDER BY updated_at DESC', r, `%${r.toLowerCase()}%`);
  need(d, `No deal matching "${r}".`);
  return d;
};
const invoiceItems = (v: unknown) => {
  const items = (Array.isArray(v) ? v : []).map((x: { description?: string; desc?: string; quantity?: number; qty?: number; unit_price?: number; price?: number }) => ({ desc: str(x.description ?? x.desc), qty: Number(x.quantity ?? x.qty ?? 1) || 1, price: Number(x.unit_price ?? x.price) || 0 }));
  need(items.length && items.every((i) => i.desc), 'Give each invoice line a description, a quantity and a unit price.');
  return items;
};
const S = (description: string) => ({ type: 'string', description });
const N = (description: string) => ({ type: 'number', description });
const L = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

export const TOOLS: Tool[] = [
  // ---------- Everywhere ----------
  { name: 'search_everything', app: 'overview', risk: 'read', description: 'Search across mail, documents, contacts, deals, invoices, tasks, meetings, chat and signatures.', params: { query: S('Words to look for') }, required: ['query'],
    summary: (a) => `Searched for "${str(a.query)}"`, run: (u, a) => search(u, str(a.query)).slice(0, 15).map(({ app, title, sub, href }) => ({ app, title, detail: sub, link: href })) },
  { name: 'whats_on_today', app: 'overview', risk: 'read', description: 'What needs the user today (overdue invoices, unread mail, signatures, tasks due, VAT) and today\'s meetings.', params: {},
    summary: () => 'Checked what needs you today', run: (u) => ({ needs_you: needsYou(u).map((t) => `${t.title} (${t.sub})`), meetings_today: schedule(u).map((s) => `${s.time} ${s.title} (${s.sub})`) }) },
  { name: 'find_people', app: 'contacts', risk: 'read', description: 'Look up colleagues and contacts by name, company or email.', params: { query: S('Name, company or email; empty for everyone') },
    summary: (a) => `Looked up "${str(a.query) || 'everyone'}"`,
    run: (_u, a) => { const q = str(a.query).toLowerCase(); return [...listUsers().map((x) => ({ name: x.name, email: x.email, kind: 'colleague' })), ...all<{ name: string; email: string; company: string; phone: string }>('SELECT name, email, company, phone FROM crm_contacts').map((c) => ({ ...c, kind: 'contact' }))].filter((p) => !q || JSON.stringify(p).toLowerCase().includes(q)).slice(0, 20); } },

  // ---------- Mail ----------
  { name: 'list_emails', app: 'mail', risk: 'read', description: 'List the user\'s emails, newest first.', params: { folder: { type: 'string', enum: ['inbox', 'sent', 'archive', 'starred'] }, query: S('Optional words to filter by'), unread_only: { type: 'boolean' } },
    summary: (a) => `Looked at ${str(a.folder) || 'inbox'}${str(a.query) ? ` for "${str(a.query)}"` : ''}`,
    run: (u, a) => listMail(u.id, (str(a.folder) || 'inbox') as Folder | 'starred', str(a.query)).filter((m) => !a.unread_only || !m.is_read).slice(0, 12).map((m) => ({ id: m.id, from: `${m.from_name || ''} <${m.from_addr}>`, to: m.to, subject: m.subject, snippet: m.snippet, unread: !m.is_read, when: fmt(m.created_at) })) },
  { name: 'read_email', app: 'mail', risk: 'read', description: 'Read a whole email conversation by email id.', params: { id: S('Email id from list_emails') }, required: ['id'],
    summary: () => 'Read an email', run: (u, a) => { const m = getMail(u.id, str(a.id)); need(m, 'That email was not found.'); return getThread(u.id, m.thread_id).slice(-6).map((x) => ({ id: x.id, from: `${x.from_name} <${x.from_addr}>`, to: x.to, subject: x.subject, when: fmt(x.created_at), body: x.body_text.slice(0, 2500) })); } },
  { name: 'send_email', app: 'mail', risk: 'send', description: 'Send an email. Recipients can be names of colleagues or contacts, or email addresses. Sign off with the user\'s name.', params: { to: L('Names or email addresses'), cc: L('Optional'), subject: S('Subject'), body: S('Plain-text message') }, required: ['to', 'subject', 'body'],
    summary: (a) => `Send an email to ${who(resolvePeople(list(a.to)))}: "${str(a.subject)}"`,
    preview: (a) => [{ label: 'To', value: who(resolvePeople(list(a.to))) }, ...(list(a.cc).length ? [{ label: 'Cc', value: who(resolvePeople(list(a.cc))) }] : []), { label: 'Subject', value: str(a.subject), editable: true, key: 'subject' }, { label: 'Message', value: str(a.body), editable: true, key: 'body' }],
    run: async (u, a) => { const r = await sendMail(u, { to: resolvePeople(list(a.to)), cc: resolvePeople(list(a.cc)), subject: str(a.subject), body: str(a.body) }); const failed = r.delivery.filter((d) => d.status === 'failed'); need(!failed.length, `Not delivered to ${failed.map((f) => f.to).join(', ')}: ${failed[0]?.detail ?? ''}`); return { sent: true, delivery: r.delivery }; },
    link: (_a, r) => `/mail`,
  },
  { name: 'reply_to_email', app: 'mail', risk: 'send', description: 'Reply to an email (to its sender) by email id.', params: { id: S('Email id'), body: S('Plain-text reply') }, required: ['id', 'body'],
    summary: (a, u) => { const m = getMail(u.id, str(a.id)); return `Reply to ${m ? (m.from_name || m.from_addr) : 'an email'}: "${m?.subject ?? ''}"`; },
    preview: (a) => [{ label: 'Reply', value: str(a.body), editable: true, key: 'body' }],
    run: async (u, a) => { const m = getMail(u.id, str(a.id)); need(m, 'That email was not found.'); const to = m.from_addr.toLowerCase() === u.email.toLowerCase() ? m.to : [m.from_addr]; await sendMail(u, { to, subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`, body: str(a.body), inReplyToId: m.id }); return { sent: true, to }; },
    link: () => '/mail' },

  // ---------- Calendar ----------
  { name: 'list_events', app: 'calendar', risk: 'read', description: 'List calendar events between two dates.', params: { from: S('YYYY-MM-DD'), to: S('YYYY-MM-DD (inclusive)') }, required: ['from', 'to'],
    summary: (a) => `Looked at the calendar ${str(a.from)} to ${str(a.to)}`,
    run: async (u, a) => ((await calendar['calendar.list'](u, { from: parseWhen(a.from, 0), to: parseWhen(a.to, 0) + 864e5 })) as { id: string; title: string; starts_at: number; ends_at: number; attendees: string[]; location: string }[]).map((e) => ({ id: e.id, title: e.title, start: fmt(e.starts_at), end: fmt(e.ends_at), with: e.attendees, where: e.location })) },
  { name: 'create_event', app: 'calendar', risk: (a) => (list(a.attendees).length ? 'send' : 'change'), description: 'Put an event in the calendar. With attendees, each gets an email invitation. Use for meetings, calls and reminders to self.', params: { title: S('Title'), start: S('Local start, YYYY-MM-DD HH:MM'), minutes: N('Length in minutes, default 30'), attendees: L('Names or email addresses; empty for a personal reminder'), video_call: { type: 'boolean', description: 'Add a video call link (default true when there are attendees)' }, location: S('Optional'), notes: S('Optional') }, required: ['title', 'start'],
    summary: (a) => `${list(a.attendees).length ? 'Schedule' : 'Add to your calendar'} "${str(a.title)}" on ${fmt(parseWhen(a.start))}${list(a.attendees).length ? ` with ${who(resolvePeople(list(a.attendees)))}` : ''}`,
    preview: (a) => [{ label: 'When', value: `${fmt(parseWhen(a.start))}, ${Number(a.minutes) || 30} minutes` }, ...(list(a.attendees).length ? [{ label: 'Invitations to', value: who(resolvePeople(list(a.attendees))) }] : [])],
    run: async (u, a) => { const start = parseWhen(a.start); const attendees = resolvePeople(list(a.attendees)); const r = await calendar['calendar.save'](u, { title: str(a.title), starts_at: start, ends_at: start + (Number(a.minutes) || 30) * 60_000, attendees: attendees.length ? [u.email, ...attendees] : [], location: str(a.location), notes: str(a.notes), addMeet: a.video_call === undefined ? attendees.length > 0 : !!a.video_call }); return { created: true, ...(r as object) }; },
    link: () => '/calendar' },
  { name: 'cancel_event', app: 'calendar', risk: 'change', description: 'Delete an event the user organised, by event id from list_events.', params: { id: S('Event id') }, required: ['id'],
    summary: (a) => { const e = get<{ title: string; starts_at: number }>('SELECT title, starts_at FROM cal_events WHERE id = ?', str(a.id)); return `Delete "${e?.title ?? 'event'}"${e ? ` on ${fmt(e.starts_at)}` : ''}`; },
    run: (u, a) => { calendar['calendar.remove'](u, { id: str(a.id) }); return { deleted: true }; }, link: () => '/calendar' },

  // ---------- Chat ----------
  { name: 'send_chat_message', app: 'chat', risk: 'send', description: 'Post in a team chat channel (by name, e.g. "general") or send a direct message to a colleague.', params: { channel: S('Channel name, without #'), person: S('Colleague name for a direct message'), text: S('Message') }, required: ['text'],
    summary: (a) => `Post in ${str(a.person) ? `a direct message to ${str(a.person)}` : `#${str(a.channel).replace(/^#/, '') || 'general'}`}: "${str(a.text).slice(0, 80)}"`,
    preview: (a) => [{ label: 'Message', value: str(a.text), editable: true, key: 'text' }],
    run: (u, a) => {
      let channelId: string;
      if (str(a.person)) channelId = (chat['chat.openDm'](u, { userId: userByName(str(a.person)).id }) as { id: string }).id;
      else { const name = str(a.channel).replace(/^#/, '').toLowerCase() || 'general'; const c = get<{ id: string }>("SELECT id FROM chat_channels WHERE kind = 'channel' AND name = ?", name); need(c, `There is no #${name} channel.`); channelId = c.id; }
      chat['chat.send'](u, { channelId, body: str(a.text) });
      return { posted: true, channelId };
    }, link: (_a, r) => `/chat?channel=${(r as { channelId: string }).channelId}` },

  // ---------- Contacts and CRM ----------
  { name: 'add_contact', app: 'contacts', risk: 'change', description: 'Add a customer or supplier to Contacts.', params: { name: S('Full name'), email: S('Optional'), company: S('Optional'), phone: S('Optional'), notes: S('Optional') }, required: ['name'],
    summary: (a) => `Add ${str(a.name)}${str(a.company) ? ` (${str(a.company)})` : ''} to Contacts`,
    run: (u, a) => crm['crm.saveContact'](u, { name: str(a.name), email: str(a.email), company: str(a.company), phone: str(a.phone), notes: str(a.notes) }), link: () => '/contacts' },
  { name: 'list_deals', app: 'crm', risk: 'read', description: 'List sales deals with their stage and value.', params: {},
    summary: () => 'Looked at the deals', run: (u) => (crm['crm.deals'](u, {}) as { id: string; title: string; stage: string; value: number; contact_name: string | null }[]).map((d) => ({ id: d.id, title: d.title, stage: d.stage, value: d.value, contact: d.contact_name })) },
  { name: 'add_deal', app: 'crm', risk: 'change', description: 'Add a sales deal to the CRM pipeline.', params: { title: S('Deal name'), value: N('Value in the company currency'), contact: S('Optional contact name') }, required: ['title'],
    summary: (a) => `Add the deal "${str(a.title)}"${Number(a.value) ? ` worth ${money(Number(a.value))}` : ''}`,
    run: (u, a) => { const c = str(a.contact) ? get<{ id: string }>('SELECT id FROM crm_contacts WHERE LOWER(name) LIKE ?', `%${str(a.contact).toLowerCase()}%`) : undefined; return crm['crm.saveDeal'](u, { title: str(a.title), value: Number(a.value) || 0, contact_id: c?.id ?? null }); }, link: () => '/crm' },
  { name: 'move_deal', app: 'crm', risk: 'change', description: 'Move a deal to another stage.', params: { deal: S('Deal name or id'), stage: { type: 'string', enum: ['lead', 'qualified', 'proposal', 'won', 'lost'] } }, required: ['deal', 'stage'],
    summary: (a) => `Move "${findDeal(a.deal).title}" to ${str(a.stage)}`, run: (u, a) => crm['crm.saveDeal'](u, { id: findDeal(a.deal).id, stage: str(a.stage) }), link: () => '/crm' },

  // ---------- Projects ----------
  { name: 'list_tasks', app: 'projects', risk: 'read', description: 'List tasks: the user\'s own across all projects, or one project\'s.', params: { project: S('Optional project name; empty for the user\'s own tasks') },
    summary: (a) => `Looked at ${str(a.project) ? `tasks in ${str(a.project)}` : 'your tasks'}`,
    run: (u, a) => { const p = str(a.project) ? get<{ id: string }>('SELECT id FROM proj_projects WHERE LOWER(name) LIKE ?', `%${str(a.project).toLowerCase()}%`) : undefined; if (str(a.project)) need(p, `No project called "${str(a.project)}".`); return (projects['projects.tasks'](u, p ? { project_id: p.id } : { mine: true }) as { id: string; title: string; status: string; assignee: string | null; due_at: number | null; project: string }[]).map((t) => ({ id: t.id, title: t.title, status: t.status, project: t.project, assignee: t.assignee, due: t.due_at ? fmt(t.due_at) : null })); } },
  { name: 'create_task', app: 'projects', risk: 'change', description: 'Add a task to a project. Without a project, it goes into the most recent project.', params: { title: S('What needs doing'), project: S('Optional project name'), assignee: S('Optional colleague name'), due: S('Optional YYYY-MM-DD'), notes: S('Optional') }, required: ['title'],
    summary: (a) => `Add the task "${str(a.title)}"${str(a.assignee) ? ` for ${str(a.assignee)}` : ''}${str(a.due) ? `, due ${str(a.due)}` : ''}`,
    run: (u, a) => {
      const p = str(a.project) ? get<{ id: string }>('SELECT id FROM proj_projects WHERE LOWER(name) LIKE ?', `%${str(a.project).toLowerCase()}%`) : get<{ id: string }>('SELECT id FROM proj_projects ORDER BY created_at DESC');
      need(p, str(a.project) ? `No project called "${str(a.project)}".` : 'There are no projects yet. Create one in Projects first.');
      return projects['projects.saveTask'](u, { project_id: p.id, title: str(a.title), notes: str(a.notes), assignee_id: str(a.assignee) ? userByName(str(a.assignee)).id : null, due_at: str(a.due) ? parseWhen(a.due, 12) : null });
    }, link: () => '/projects' },
  { name: 'complete_task', app: 'projects', risk: 'change', description: 'Mark a task as done.', params: { task: S('Task title or id') }, required: ['task'],
    summary: (a) => `Mark "${findTask(a.task).title}" as done`, run: (u, a) => projects['projects.saveTask'](u, { id: findTask(a.task).id, status: 'done' }), link: () => '/projects' },

  // ---------- Docs ----------
  { name: 'list_documents', app: 'docs', risk: 'read', description: 'List documents, spreadsheets or presentations.', params: { kind: { type: 'string', enum: ['doc', 'sheet', 'deck'] } },
    summary: () => 'Looked at the documents', run: (_u, a) => all<{ id: string; kind: string; title: string; updated_at: number }>(`SELECT id, kind, title, updated_at FROM office_files ${str(a.kind) ? 'WHERE kind = ?' : ''} ORDER BY updated_at DESC LIMIT 20`, ...(str(a.kind) ? [str(a.kind)] : [])).map((f) => ({ ...f, updated_at: fmt(f.updated_at) })) },
  { name: 'write_document', app: 'docs', risk: 'change', description: 'Write a new document in Docs from instructions (a letter, proposal, policy, notes).', params: { title: S('Document title'), instructions: S('What the document should say') }, required: ['title', 'instructions'],
    summary: (a) => `Write the document "${str(a.title)}"`,
    run: async (u, a) => {
      const text = await ai([{ role: 'system', content: 'Write the document asked for. Plain text, paragraphs separated by blank lines, no markdown symbols.' }, { role: 'user', content: str(a.instructions).slice(0, 4000) }], { maxTokens: 1200 });
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const id = createFile(u, 'doc', str(a.title), text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
      return { id };
    }, link: (_a, r) => `/docs?id=${(r as { id: string }).id}` },

  // ---------- Accounting ----------
  { name: 'list_invoices', app: 'accounting', risk: 'read', description: 'List invoices with status (draft, sent, paid) and whether they are overdue.', params: { status: { type: 'string', enum: ['draft', 'sent', 'paid', 'overdue'] }, customer: S('Optional customer name') },
    summary: () => 'Looked at the invoices',
    run: (u, a) => (accounting['acc.invoices'](u, {}) as { id: string; number: string; customer_name: string; customer_email: string; status: string; total: number; due_at: number; overdue: boolean }[])
      .filter((i) => (!str(a.status) || (str(a.status) === 'overdue' ? i.overdue : i.status === str(a.status))) && (!str(a.customer) || i.customer_name.toLowerCase().includes(str(a.customer).toLowerCase())))
      .slice(0, 15).map((i) => ({ number: i.number, customer: i.customer_name, email: i.customer_email, status: i.overdue ? 'overdue' : i.status, total: money(i.total), due: fmt(i.due_at) })) },
  { name: 'accounting_summary', app: 'accounting', risk: 'read', description: 'Revenue, expenses, profit, VAT position and money owed to the company.', params: {},
    summary: () => 'Checked the accounts', run: (u) => accounting['acc.summary'](u, {}) },
  { name: 'create_invoice', app: 'accounting', risk: 'change', description: 'Create a draft invoice (not sent yet). Customer can be a contact name.', params: { customer: S('Customer name'), email: S('Customer email if known'), lines: { type: 'array', description: 'Invoice lines', items: { type: 'object', properties: { description: { type: 'string' }, quantity: { type: 'number' }, unit_price: { type: 'number' } }, required: ['description', 'unit_price'] } }, vat_rate: N('VAT percent, default 21'), due_days: N('Days to pay, default 30') }, required: ['customer', 'lines'],
    summary: (a) => { const items = invoiceItems(a.lines); return `Create a draft invoice for ${str(a.customer)}: ${money(items.reduce((s, i) => s + i.qty * i.price, 0))} excl. VAT`; },
    preview: (a) => invoiceItems(a.lines).map((i) => ({ label: i.desc, value: `${i.qty} × ${money(i.price)}` })),
    run: (u, a) => { const c = get<{ id: string; name: string; email: string }>('SELECT id, name, email FROM crm_contacts WHERE LOWER(name) LIKE ? OR LOWER(company) LIKE ?', `%${str(a.customer).toLowerCase()}%`, `%${str(a.customer).toLowerCase()}%`); return accounting['acc.createInvoice'](u, { contact_id: c?.id, customer_name: c?.name ?? str(a.customer), customer_email: str(a.email) || c?.email || '', items: invoiceItems(a.lines), vat_rate: a.vat_rate === undefined ? 21 : Number(a.vat_rate), dueDays: Number(a.due_days) || 30 }); },
    link: () => '/accounting' },
  { name: 'send_invoice', app: 'accounting', risk: 'send', description: 'Email a draft invoice to the customer.', params: { invoice: S('Invoice number, e.g. INV-0003') }, required: ['invoice'],
    summary: (a) => { const i = findInvoice(a.invoice); return `Email invoice ${i.number} to ${i.customer_name} <${i.customer_email}>`; },
    run: (u, a) => accounting['acc.sendInvoice'](u, { id: findInvoice(a.invoice).id }), link: () => '/accounting' },
  { name: 'send_payment_reminder', app: 'accounting', risk: 'send', description: 'Email a payment reminder for an unpaid invoice.', params: { invoice: S('Invoice number') }, required: ['invoice'],
    summary: (a) => { const i = findInvoice(a.invoice); return `Email a payment reminder for ${i.number} to ${i.customer_name}`; },
    run: (u, a) => accounting['acc.remind'](u, { id: findInvoice(a.invoice).id }), link: () => '/accounting' },
  { name: 'mark_invoice_paid', app: 'accounting', risk: 'change', description: 'Record that an invoice has been paid.', params: { invoice: S('Invoice number') }, required: ['invoice'],
    summary: (a) => `Mark invoice ${findInvoice(a.invoice).number} as paid`, run: (u, a) => accounting['acc.setStatus'](u, { id: findInvoice(a.invoice).id, status: 'paid' }), link: () => '/accounting' },
  { name: 'add_expense', app: 'accounting', risk: 'change', description: 'Record an expense.', params: { vendor: S('Who was paid'), amount: N('Amount excluding VAT'), vat: N('VAT paid, default 0'), category: { type: 'string', enum: ['Software', 'Office', 'Travel', 'Marketing', 'Salaries', 'Professional fees', 'Equipment', 'Bank fees', 'Other'] }, description: S('What for'), date: S('YYYY-MM-DD, default today') }, required: ['vendor', 'amount'],
    summary: (a) => `Record an expense: ${str(a.vendor)}, ${money(Number(a.amount) || 0)}`, run: (u, a) => accounting['acc.addExpense'](u, { vendor: str(a.vendor), amount: Number(a.amount), vat: Number(a.vat) || 0, category: str(a.category) || 'Other', description: str(a.description), spent_at: str(a.date) ? parseWhen(a.date, 12) : Date.now() }), link: () => '/accounting' },

  // ---------- Tax ----------
  { name: 'vat_return', app: 'tax', risk: 'read', description: 'VAT figures for a quarter.', params: { quarter: S('Like 2026-Q4; default the current quarter') },
    summary: (a) => `Looked at VAT for ${str(a.quarter) || 'this quarter'}`,
    run: (u, a) => { const d = new Date(); const q = str(a.quarter) || `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`; const r = tax['tax.return'](u, { period: q }) as { vatCharged: number; vatPaid: number; vatDue: number; salesNet: number; filed: unknown }; return { quarter: q, sales_excl_vat: r.salesNet, vat_charged: r.vatCharged, vat_paid: r.vatPaid, vat_due: r.vatDue, filed: !!r.filed }; } },
];

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);
export const riskOf = (t: Tool, a: Args): Risk => (typeof t.risk === 'function' ? t.risk(a) : t.risk);

// ---------- More apps: Sheets, Slides, Sign, bank and books, quotes, recurring invoices, booking links, chat ----------
import { createEvaluator, display, parseBook, parseRef, type Sheet } from '../formula.ts';
import { books } from '../apps/books.ts';
import { booking } from '../apps/booking.ts';
import { office } from '../apps/office.ts';
import { sign } from '../apps/sign.ts';

const findFile = (kind: 'doc' | 'sheet' | 'deck', ref: unknown) => {
  const r = str(ref);
  const f = get<{ id: string; title: string; content: string; rev: number }>('SELECT id, title, content, rev FROM office_files WHERE kind = ? AND (id = ? OR LOWER(title) = LOWER(?))', kind, r, r)
    ?? get<{ id: string; title: string; content: string; rev: number }>('SELECT id, title, content, rev FROM office_files WHERE kind = ? AND LOWER(title) LIKE ? ORDER BY updated_at DESC', kind, `%${r.toLowerCase()}%`);
  need(f, `No ${kind === 'sheet' ? 'spreadsheet' : kind === 'deck' ? 'presentation' : 'document'} called "${r}". Use list_documents to see them.`);
  return f;
};
const pickSheet = (book: Sheet[], name: unknown) => {
  const n = str(name);
  let i = n ? book.findIndex((s) => s.name.toLowerCase() === n.toLowerCase()) : 0;
  // A made-up default name ("Sheet1") means "the first sheet".
  if (i < 0 && /^sheet\s*1$/i.test(n)) i = 0;
  need(i >= 0, `There is no sheet "${n}". Sheets: ${book.map((s) => s.name).join(', ')}.`);
  return i;
};
type CellEdit = { cell: string; value: string };
const cellEdits = (v: unknown): CellEdit[] => {
  const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.entries(v as object).map(([cell, value]) => ({ cell, value })) : [];
  const out = list.map((x: { cell?: string; value?: unknown }) => ({ cell: str(x.cell).toUpperCase().replace(/\$/g, ''), value: x.value == null ? '' : String(x.value) }));
  need(out.length && out.every((e) => /^[A-Z]{1,2}\d{1,5}$/.test(e.cell)), 'Give each change a cell like B4 and a value (a number, text or a formula starting with =).');
  need(out.length <= 500, 'At most 500 cells can be changed at once.');
  return out;
};
const ORIGIN = () => publicUrl(loadConfig().host, loadConfig().port);

TOOLS.push(
  // Sheets
  { name: 'read_spreadsheet', app: 'sheets', risk: 'read', description: 'Read a spreadsheet: its sheets and the cells with their calculated values.', params: { name: S('Spreadsheet title'), sheet: S('Optional sheet name, default the first') }, required: ['name'],
    summary: (a) => `Read the spreadsheet "${str(a.name)}"`,
    run: (_u, a) => {
      const f = findFile('sheet', a.name); const book = parseBook(f.content); const si = pickSheet(book, a.sheet); const ev = createEvaluator(book);
      const refs = Object.keys(book[si].cells).sort((x, y) => { const p = parseRef(x), q = parseRef(y); return p.row - q.row || p.col - q.col; }).slice(0, 300);
      return { spreadsheet: f.title, sheets: book.map((s) => s.name), sheet: book[si].name, cells: Object.fromEntries(refs.map((r) => { const raw = book[si].cells[r]; const shown = display(ev(si, r), book[si].formats?.[r], loadConfig().currency); return [r, raw.startsWith('=') ? `${raw} → ${shown}` : shown]; })) };
    }, link: (a) => `/sheets?id=${findFile('sheet', a.name).id}` },
  { name: 'update_spreadsheet', app: 'sheets', risk: 'change', description: 'Change cells in a spreadsheet: values, text or formulas such as =SUM(B2:B9). An empty value clears the cell.', params: { name: S('Spreadsheet title'), sheet: S('Optional sheet name'), cells: { type: 'array', description: 'Cells to set', items: { type: 'object', properties: { cell: { type: 'string', description: 'Like B4' }, value: { type: 'string' } }, required: ['cell', 'value'] } } }, required: ['name', 'cells'],
    summary: (a) => { const e = cellEdits(a.cells); return `Change ${e.length} cell${e.length === 1 ? '' : 's'} in "${findFile('sheet', a.name).title}" (${e.slice(0, 4).map((x) => x.cell).join(', ')}${e.length > 4 ? '…' : ''})`; },
    preview: (a) => cellEdits(a.cells).slice(0, 12).map((e) => ({ label: e.cell, value: e.value || '(clear)' })),
    run: async (u, a) => {
      const f = findFile('sheet', a.name); const book = parseBook(f.content); const si = pickSheet(book, a.sheet);
      const cells = { ...book[si].cells };
      for (const e of cellEdits(a.cells)) { if (e.value === '') delete cells[e.cell]; else cells[e.cell] = e.value; }
      book[si] = { ...book[si], cells };
      const r = (await office['office.save'](u, { id: f.id, content: JSON.stringify({ sheets: book }), rev: f.rev })) as { conflict?: boolean; by?: string };
      need(!r.conflict, `${r.by} changed this spreadsheet a moment ago. Try again.`);
      const ev = createEvaluator(book);
      const show = (r: string) => display(ev(si, r), book[si].formats?.[r], loadConfig().currency);
      // Report the changed cells and every formula on the sheet, so totals can be read without another call.
      return { saved: true, sheet: book[si].name, changed: Object.fromEntries(cellEdits(a.cells).map((e) => [e.cell, show(e.cell)])), formulas_now: Object.fromEntries(Object.entries(cells).filter(([, v]) => v.startsWith('=')).slice(0, 60).map(([r, v]) => [r, `${v} → ${show(r)}`])) };
    }, link: (a) => `/sheets?id=${findFile('sheet', a.name).id}` },
  { name: 'create_spreadsheet', app: 'sheets', risk: 'change', description: 'Make a new spreadsheet from rows of cells. Cells can hold numbers, text or formulas.', params: { title: S('Title'), rows: { type: 'array', description: 'Rows from the top, each a list of cell values starting at column A', items: { type: 'array', items: { type: 'string' } } } }, required: ['title', 'rows'],
    summary: (a) => `Make the spreadsheet "${str(a.title)}"`,
    run: (u, a) => {
      const rows = (Array.isArray(a.rows) ? a.rows : []).slice(0, 500) as unknown[][];
      const cells: Record<string, string> = {};
      rows.forEach((row, r) => (Array.isArray(row) ? row : [row]).slice(0, 26).forEach((v, c) => { const s = v == null ? '' : String(v); if (s) cells[`${String.fromCharCode(65 + c)}${r + 1}`] = s; }));
      need(Object.keys(cells).length, 'Give the spreadsheet at least one value.');
      return { id: createFile(u, 'sheet', str(a.title), JSON.stringify({ sheets: [{ name: 'Sheet1', cells, formats: Object.fromEntries(Object.keys(cells).filter((k) => /^[A-Z]1$/.test(k)).map((k) => [k, { b: 1 }])) }] })) };
    }, link: (_a, r) => `/sheets?id=${(r as { id: string }).id}` },
  // Slides
  { name: 'write_presentation', app: 'slides', risk: 'change', description: 'Make a new presentation with slides about a topic.', params: { title: S('Title'), topic: S('What it should cover') }, required: ['title', 'topic'],
    summary: (a) => `Make the presentation "${str(a.title)}"`,
    run: async (u, a) => { const { slides } = (await office['office.aiDeck'](u, { topic: `${str(a.title)}: ${str(a.topic)}` })) as { slides: unknown[] }; return { id: createFile(u, 'deck', str(a.title), JSON.stringify({ theme: 'light', slides: [{ title: str(a.title), body: loadConfig().company.name, layout: 'title' }, ...slides] })), slides: slides.length + 1 }; },
    link: (_a, r) => `/slides?id=${(r as { id: string }).id}` },
  // Sign
  { name: 'list_signature_requests', app: 'sign', risk: 'read', description: 'PDFs uploaded to Sign, who has signed and who has not.', params: {},
    summary: () => 'Looked at the signature requests',
    run: (u) => (sign['sign.list'](u, {}) as { name: string; status: string; mine: boolean; signers: { name: string; email: string; signed_at: number | null }[] }[]).map((d) => ({ document: d.name, status: d.status === 'completed' ? 'signed by everyone' : d.status === 'sent' ? 'waiting for signatures' : 'not sent yet', sent_by_me: d.mine, signers: d.signers.map((s) => `${s.name} <${s.email}>: ${s.signed_at ? `signed ${fmt(s.signed_at)}` : 'not signed'}`) })) },
  { name: 'request_signature', app: 'sign', risk: 'send', description: 'Email people a private link to sign a PDF that is already uploaded in Sign.', params: { document: S('Document name'), signers: L('Names or email addresses'), message: S('Optional note for the signers') }, required: ['document', 'signers'],
    summary: (a, u) => `Ask ${who(resolvePeople(list(a.signers)))} to sign "${mySignDoc(u, a.document).name}"`,
    preview: (a) => (str(a.message) ? [{ label: 'Note', value: str(a.message), editable: true, key: 'message' }] : []),
    run: (u, a) => { const d = mySignDoc(u, a.document); return sign['sign.request'](u, { id: d.id, signers: resolvePeople(list(a.signers)).map((email) => ({ name: nameOf(email) === email ? email.split('@')[0] : nameOf(email), email })), message: str(a.message) }); },
    link: () => '/sign' },
  // Bank and books
  { name: 'list_bank_lines', app: 'accounting', risk: 'read', description: 'Imported bank statement lines, with suggested matches for the ones not yet checked.', params: { all: { type: 'boolean', description: 'true for every line; default only lines still to check' } },
    summary: () => 'Looked at the bank lines',
    run: (u, a) => { const b = books['books.bank'](u, {}) as { summary: object; lines: { id: string; date: number; description: string; amount: number; match_kind: string | null; ignored: number; suggestions: { kind: string; id: string; label: string }[] }[] }; return { summary: b.summary, lines: b.lines.filter((l) => a.all || (!l.match_kind && !l.ignored)).slice(0, 25).map((l) => ({ line_id: l.id, date: fmt(l.date), description: l.description, amount: money(l.amount), status: l.match_kind ? `matched (${l.match_kind})` : l.ignored ? 'ignored' : 'to check', suggestions: l.suggestions.map((s) => ({ kind: s.kind, id: s.id, what: s.label })), next_step: l.match_kind || l.ignored ? undefined : l.suggestions.length ? `match_bank_line line_id=${l.id} kind=${l.suggestions[0].kind} id=${l.suggestions[0].id} (${l.suggestions[0].label})` : `book_bank_line line_id=${l.id}` })) }; } },
  { name: 'match_bank_line', app: 'accounting', risk: 'change', description: 'Confirm a bank line is a customer paying an invoice (marks it paid) or an expense already entered. Use a suggestion from list_bank_lines.', params: { line_id: S('From list_bank_lines'), kind: { type: 'string', enum: ['invoice', 'expense'] }, id: S('The suggestion id') }, required: ['line_id', 'kind', 'id'],
    summary: (a) => `Match a bank line to ${str(a.kind) === 'invoice' ? `invoice ${get<{ number: string }>('SELECT number FROM acc_invoices WHERE id = ?', str(a.id))?.number ?? ''}` : 'an expense'}`,
    run: (u, a) => books['books.match'](u, { lineId: str(a.line_id), kind: str(a.kind), id: str(a.id) }), link: () => '/accounting' },
  { name: 'match_all_bank_lines', app: 'accounting', risk: 'change', description: 'Match every bank line that has exactly one clear suggestion (customer payments to their invoices, payments to expenses already entered). Do this first when asked to go through the bank; then book what is left with book_bank_line.', params: {},
    summary: () => 'Match the bank lines that have one clear match',
    run: (u) => {
      const b = books['books.bank'](u, {}) as { lines: { id: string; description: string; amount: number; match_kind: string | null; ignored: number; suggestions: { kind: string; id: string; label: string }[] }[] };
      const matched: string[] = [], left: unknown[] = [];
      for (const l of b.lines.filter((x) => !x.match_kind && !x.ignored)) {
        if (l.suggestions.length === 1) { books['books.match'](u, { lineId: l.id, kind: l.suggestions[0].kind, id: l.suggestions[0].id }); matched.push(`${l.description} ${money(l.amount)} → ${l.suggestions[0].label}`); }
        else left.push({ line_id: l.id, description: l.description, amount: money(l.amount), choices: l.suggestions.map((s) => s.label) });
      }
      return { matched, still_to_book: left };
    }, link: () => '/accounting' },
  { name: 'book_bank_line', app: 'accounting', risk: 'change', description: 'Book a bank line that matches nothing: money out as a new expense, or anything else against an account (3000 owner money, 2200 loan, 5070 bank fees, 2100 VAT payment, 4900 other income).', params: { line_id: S('From list_bank_lines'), as: { type: 'string', enum: ['expense', 'other'] }, vendor: S('For an expense'), category: { type: 'string', enum: ['Software', 'Office', 'Travel', 'Marketing', 'Salaries', 'Professional fees', 'Equipment', 'Bank fees', 'Other'] }, vat: N('VAT included, for an expense'), account: S('Account code, for other') }, required: ['line_id', 'as'],
    summary: (a) => `Book a bank line as ${str(a.as) === 'expense' ? `an expense${str(a.vendor) ? ` (${str(a.vendor)})` : ''}` : `account ${str(a.account)}`}`,
    run: (u, a) => books['books.bookLine'](u, { lineId: str(a.line_id), as: str(a.as) === 'expense' ? 'expense' : 'journal', vendor: str(a.vendor), category: str(a.category), vat: Number(a.vat) || 0, account: str(a.account) }), link: () => '/accounting' },
  { name: 'books_report', app: 'accounting', risk: 'read', description: 'Profit and loss for a period and the balance sheet at its end, from the double-entry books.', params: { from: S('YYYY-MM-DD, default 1 January'), to: S('YYYY-MM-DD, default today') },
    summary: () => 'Looked at the books',
    run: (u, a) => books['books.reports'](u, { from: str(a.from) ? parseWhen(a.from, 0) : new Date(new Date().getFullYear(), 0, 1).getTime(), to: str(a.to) ? parseWhen(a.to, 0) + 864e5 : Date.now() + 1 }) },
  // Quotes and recurring invoices
  { name: 'create_quote', app: 'accounting', risk: 'change', description: 'Create a draft quote (an offer with prices) for a customer.', params: { customer: S('Customer name'), email: S('Customer email if known'), lines: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, quantity: { type: 'number' }, unit_price: { type: 'number' } }, required: ['description', 'unit_price'] } }, vat_rate: N('VAT percent, default 21') }, required: ['customer', 'lines'],
    summary: (a) => `Create a draft quote for ${str(a.customer)}: ${money(invoiceItems(a.lines).reduce((s, i) => s + i.qty * i.price, 0))} excl. VAT`,
    run: (u, a) => { const c = get<{ id: string; name: string; email: string }>('SELECT id, name, email FROM crm_contacts WHERE LOWER(name) LIKE ? OR LOWER(company) LIKE ?', `%${str(a.customer).toLowerCase()}%`, `%${str(a.customer).toLowerCase()}%`); return accounting['acc.createInvoice'](u, { kind: 'quote', contact_id: c?.id, customer_name: c?.name ?? str(a.customer), customer_email: str(a.email) || c?.email || '', items: invoiceItems(a.lines), vat_rate: a.vat_rate === undefined ? 21 : Number(a.vat_rate) }); },
    link: () => '/accounting' },
  { name: 'set_up_recurring_invoice', app: 'accounting', risk: (a) => (a.email_automatically ? 'send' : 'change'), description: 'Invoice a customer automatically every week, month, quarter or year.', params: { customer: S('Customer name'), email: S('Customer email'), lines: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, quantity: { type: 'number' }, unit_price: { type: 'number' } }, required: ['description', 'unit_price'] } }, every: { type: 'string', enum: ['week', 'month', 'quarter', 'year'] }, first_date: S('YYYY-MM-DD of the first invoice, default today'), email_automatically: { type: 'boolean', description: 'Email each invoice when made (default false: saved as drafts)' }, vat_rate: N('Default 21') }, required: ['customer', 'lines', 'every'],
    summary: (a) => `Invoice ${str(a.customer)} every ${str(a.every)} (${money(invoiceItems(a.lines).reduce((s, i) => s + i.qty * i.price, 0))} excl. VAT)${a.email_automatically ? ', emailed automatically' : ''}`,
    run: (u, a) => { const c = get<{ id: string; name: string; email: string }>('SELECT id, name, email FROM crm_contacts WHERE LOWER(name) LIKE ?', `%${str(a.customer).toLowerCase()}%`); return accounting['acc.saveRecurring'](u, { contact_id: c?.id, customer_name: c?.name ?? str(a.customer), customer_email: str(a.email) || c?.email || '', items: invoiceItems(a.lines), vat_rate: a.vat_rate === undefined ? 21 : Number(a.vat_rate), every: str(a.every), next_at: str(a.first_date) ? parseWhen(a.first_date) : Date.now(), auto_send: !!a.email_automatically, active: true }); },
    link: () => '/accounting' },
  // Booking links
  { name: 'list_booking_links', app: 'calendar', risk: 'read', description: 'The user\'s booking pages, with the link people use to book time. Useful to put in an email.', params: {},
    summary: () => 'Looked up your booking links', run: (u) => (booking['booking.list'](u, {}) as { title: string; minutes: number; url: string; active: number }[]).map((p) => ({ title: p.title, minutes: p.minutes, link: `${ORIGIN()}${p.url}`, open: !!p.active })) },
  // Chat
  { name: 'read_chat', app: 'chat', risk: 'read', description: 'Read recent messages in a channel or a direct conversation with a colleague.', params: { channel: S('Channel name'), person: S('Colleague name for direct messages') },
    summary: (a) => `Read ${str(a.person) ? `messages with ${str(a.person)}` : `#${str(a.channel).replace(/^#/, '') || 'general'}`}`,
    run: (u, a) => {
      let channelId: string;
      if (str(a.person)) channelId = (chat['chat.openDm'](u, { userId: userByName(str(a.person)).id }) as { id: string }).id;
      else { const name = str(a.channel).replace(/^#/, '').toLowerCase() || 'general'; const c = get<{ id: string }>("SELECT id FROM chat_channels WHERE kind = 'channel' AND name = ?", name); need(c, `There is no #${name} channel.`); channelId = c.id; }
      return (chat['chat.messages'](u, { channelId }) as { body: string; name: string; created_at: number }[]).slice(-20).map((m) => `${fmt(m.created_at)} ${m.name}: ${m.body}`);
    } },
);

function mySignDoc(u: User, ref: unknown) {
  const r = str(ref).toLowerCase();
  const d = get<{ id: string; name: string }>("SELECT id, name FROM sign_docs WHERE owner_id = ? AND status != 'completed' AND (id = ? OR LOWER(name) LIKE ?) ORDER BY created_at DESC", u.id, str(ref), `%${r}%`);
  need(d, `No unsigned PDF called "${str(ref)}" is uploaded in Sign. Upload it in Sign first.`);
  return d;
}

// ---------- LinkedIn ----------
import { addLead, draftPost, linkedin } from '../apps/linkedin.ts';
const findLead = (ref: unknown) => {
  const r = str(ref).toLowerCase();
  const l = get<{ id: string; name: string; message: string; profile_url: string }>('SELECT id, name, message, profile_url FROM li_leads WHERE id = ? OR LOWER(name) = ? OR LOWER(name) LIKE ? ORDER BY updated_at DESC', str(ref), r, `%${r}%`);
  need(l, `No LinkedIn lead called "${str(ref)}".`);
  return l;
};
const findCampaign = (ref: unknown) => { if (!str(ref)) return undefined; const c = get<{ id: string; name: string }>('SELECT id, name FROM li_campaigns WHERE id = ? OR LOWER(name) LIKE ?', str(ref), `%${str(ref).toLowerCase()}%`); need(c, `No campaign called "${str(ref)}".`); return c; };
TOOLS.push(
  { name: 'linkedin_overview', app: 'linkedin', risk: 'read', description: 'LinkedIn: whether the account is connected, posts (drafts, scheduled, published), leads by stage and campaigns.', params: {},
    summary: () => 'Looked at LinkedIn', run: (u) => ({ ...(linkedin['li.summary'](u, {}) as object), campaigns: (linkedin['li.campaigns'](u, {}) as { name: string; status: string; posts: unknown; leads: unknown }[]).map((c) => ({ name: c.name, status: c.status, posts: c.posts, leads: c.leads })) }) },
  { name: 'draft_linkedin_post', app: 'linkedin', risk: (a) => (str(a.post_at) ? 'send' : 'change'), description: 'Write a LinkedIn post about a topic and save it as a draft, or schedule it for a time. It is not published until that time.', params: { topic: S('What the post is about'), campaign: S('Optional campaign name'), post_at: S('Optional YYYY-MM-DD HH:MM to schedule it') }, required: ['topic'],
    summary: (a) => `${str(a.post_at) ? `Schedule a LinkedIn post for ${fmt(parseWhen(a.post_at))}` : 'Draft a LinkedIn post'} about "${str(a.topic)}"`,
    run: async (u, a) => { const c = findCampaign(a.campaign); const camp = c ? get<{ goal: string; audience: string; offer: string }>('SELECT goal, audience, offer FROM li_campaigns WHERE id = ?', c.id) : undefined; const text = await draftPost(str(a.topic), camp); const r = linkedin['li.savePost'](u, { text, campaignId: c?.id ?? null, scheduledAt: str(a.post_at) ? parseWhen(a.post_at) : null }) as { id: string; status: string }; return { ...r, text }; },
    link: () => '/linkedin' },
  { name: 'publish_linkedin_post', app: 'linkedin', risk: 'send', description: 'Publish a draft LinkedIn post now, on the connected profile. Use the post text start or id from linkedin_overview or draft_linkedin_post.', params: { post: S('Post id, or the first words of the post') }, required: ['post'],
    summary: (a) => `Publish on LinkedIn: "${liPost(a.post).text.slice(0, 70)}…"`,
    preview: (a) => [{ label: 'Post', value: liPost(a.post).text }],
    run: (u, a) => linkedin['li.publishNow'](u, { id: liPost(a.post).id }), link: () => '/linkedin' },
  { name: 'list_leads', app: 'linkedin', risk: 'read', description: 'LinkedIn leads, best fit first, with stage and campaign.', params: { stage: { type: 'string', enum: ['new', 'contacted', 'replied', 'meeting', 'won', 'not interested'] }, campaign: S('Optional campaign name') },
    summary: () => 'Looked at the LinkedIn leads',
    run: (u, a) => (linkedin['li.leads'](u, { campaignId: findCampaign(a.campaign)?.id, status: str(a.stage) || undefined }) as { name: string; headline: string; company: string; status: string; score: number | null; campaign: string | null; email: string }[]).slice(0, 25).map((l) => ({ name: l.name, role: l.headline, company: l.company, stage: l.status, fit: l.score, campaign: l.campaign, email: l.email || undefined })) },
  { name: 'add_lead', app: 'linkedin', risk: 'change', description: 'Add a person to the LinkedIn leads list.', params: { name: S('Full name'), role: S('Job title'), company: S('Company'), profile_url: S('LinkedIn profile link'), email: S('Optional'), campaign: S('Optional campaign name') }, required: ['name'],
    summary: (a) => `Add ${str(a.name)} to the LinkedIn leads`, run: (_u, a) => addLead({ name: str(a.name), headline: str(a.role), company: str(a.company), profile_url: str(a.profile_url), email: str(a.email), campaign_id: findCampaign(a.campaign)?.id ?? null }), link: () => '/linkedin' },
  { name: 'update_lead', app: 'linkedin', risk: 'change', description: 'Move a LinkedIn lead to another stage, or add a note.', params: { lead: S('Lead name'), stage: { type: 'string', enum: ['new', 'contacted', 'replied', 'meeting', 'won', 'not interested'] }, note: S('Optional note to add') }, required: ['lead'],
    summary: (a) => `Update ${findLead(a.lead).name}${str(a.stage) ? ` to "${str(a.stage)}"` : ''}`,
    run: (u, a) => { const l = findLead(a.lead); const notes = get<{ notes: string }>('SELECT notes FROM li_leads WHERE id = ?', l.id)!.notes; return linkedin['li.saveLead'](u, { id: l.id, ...(str(a.stage) ? { status: str(a.stage) } : {}), ...(str(a.note) ? { notes: [notes, str(a.note)].filter(Boolean).join('\n') } : {}) }); }, link: () => '/linkedin' },
  { name: 'write_linkedin_message', app: 'linkedin', risk: 'change', description: 'Write a personal LinkedIn message for a lead. The user sends it themselves from LinkedIn; databag never sends LinkedIn messages.', params: { lead: S('Lead name') }, required: ['lead'],
    summary: (a) => `Write a LinkedIn message for ${findLead(a.lead).name}`, run: async (u, a) => ({ ...(await linkedin['li.writeMessage'](u, { id: findLead(a.lead).id }) as object), note: 'Tell the user to open LinkedIn → Leads → Message to copy it and send it themselves.' }), link: () => '/linkedin' },
  { name: 'lead_to_crm', app: 'linkedin', risk: 'change', description: 'Turn a LinkedIn lead into a CRM contact with a deal, for sales follow-up.', params: { lead: S('Lead name'), deal_value: N('Optional expected deal value') }, required: ['lead'],
    summary: (a) => `Move ${findLead(a.lead).name} into the CRM`, run: (u, a) => linkedin['li.toCrm'](u, { id: findLead(a.lead).id, value: Number(a.deal_value) || 0 }), link: () => '/crm' },
  { name: 'create_campaign', app: 'linkedin', risk: 'change', description: 'Start a LinkedIn campaign, optionally drafting a series of posts for it (saved as drafts to review).', params: { name: S('Campaign name'), goal: S('What it should achieve'), audience: S('Who it is for'), offer: S('What is offered'), draft_posts: N('How many posts to draft, 0 to 8') }, required: ['name'],
    summary: (a) => `Start the LinkedIn campaign "${str(a.name)}"${Number(a.draft_posts) ? ` with ${Number(a.draft_posts)} draft posts` : ''}`,
    run: async (u, a) => { const { id } = linkedin['li.saveCampaign'](u, { name: str(a.name), goal: str(a.goal), audience: str(a.audience), offer: str(a.offer) }) as { id: string }; const n = Math.min(8, Number(a.draft_posts) || 0); return { id, ...(n ? (await linkedin['li.planPosts'](u, { id, count: n })) as object : {}) }; }, link: () => '/linkedin' },
);
function liPost(ref: unknown) {
  const r = str(ref);
  const p = get<{ id: string; text: string }>("SELECT id, text FROM li_posts WHERE status != 'published' AND (id = ? OR text LIKE ?) ORDER BY updated_at DESC", r, `${r.slice(0, 60).replace(/[%_]/g, '')}%`)
    ?? get<{ id: string; text: string }>("SELECT id, text FROM li_posts WHERE status != 'published' AND text LIKE ? ORDER BY updated_at DESC", `%${r.slice(0, 40).replace(/[%_]/g, '')}%`);
  need(p, 'No unpublished LinkedIn post matches that. Use linkedin_overview or draft one first.');
  return p;
}
