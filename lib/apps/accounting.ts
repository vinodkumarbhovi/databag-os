import crypto from 'node:crypto';
import { type User, listUsers } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { sendMail } from '../mail/store.ts';
import { type Handlers, need } from '../rpc.ts';

type Item = { desc: string; qty: number; price: number };
type Invoice = { id: string; number: string; contact_id: string | null; customer_name: string; customer_email: string; items: string; vat_rate: number; status: string; issued_at: number; due_at: number; kind: 'invoice' | 'quote'; reminded_at: number | null };
const net = (items: Item[]) => items.reduce((sum, i) => sum + i.qty * i.price, 0);
const round = (n: number) => Math.round(n * 100) / 100;
const withTotals = (inv: Invoice) => {
  const items = JSON.parse(inv.items) as Item[];
  const subtotal = round(net(items));
  const vat = round((subtotal * inv.vat_rate) / 100);
  return { ...inv, items, subtotal, vat, total: round(subtotal + vat) };
};

export const accounting: Handlers = {
  'acc.invoices': () => all<Invoice>("SELECT * FROM acc_invoices WHERE kind = 'invoice' ORDER BY issued_at DESC, number DESC").map((i) => ({ ...withTotals(i), overdue: i.status === 'sent' && i.due_at < Date.now() })),
  'acc.quotes': () => all<Invoice>("SELECT * FROM acc_invoices WHERE kind = 'quote' ORDER BY issued_at DESC, number DESC").map(withTotals),

  'acc.createInvoice': (u, i: { contact_id?: string; customer_name: string; customer_email?: string; items: Item[]; vat_rate: number; dueDays?: number; kind?: 'invoice' | 'quote' }) => {
    need(i.customer_name?.trim(), 'Who is the invoice for?');
    const items = (i.items ?? []).map((x) => ({ desc: String(x.desc ?? '').trim(), qty: Number(x.qty) || 0, price: Number(x.price) || 0 })).filter((x) => x.desc && x.qty);
    need(items.length, 'Add at least one line with a description and a quantity.');
    const kind = i.kind === 'quote' ? 'quote' : 'invoice';
    const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM acc_invoices WHERE kind = ?', kind)!.n;
    const id = crypto.randomUUID();
    const number = `${kind === 'quote' ? 'QUO' : 'INV'}-${String(count + 1).padStart(4, '0')}`;
    const now = Date.now();
    run('INSERT INTO acc_invoices (id, number, contact_id, customer_name, customer_email, items, vat_rate, issued_at, due_at, created_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, number, i.contact_id || null, i.customer_name.trim(), (i.customer_email ?? '').trim().toLowerCase(), JSON.stringify(items), Number(i.vat_rate) || 0, now, now + (i.dueDays ?? 30) * 864e5, now, kind);
    emit({ type: `acc.${kind}.created`, app: 'accounting', userId: u.id, summary: `${kind === 'quote' ? 'Quote' : 'Invoice'} ${number} created for ${i.customer_name.trim()}`, payload: { invoiceId: id } });
    return { id, number };
  },

  /** Email the invoice to the customer through Mail and mark it sent. */
  'acc.sendInvoice': async (u, { id }: { id: string }) => {
    const row = get<Invoice>('SELECT * FROM acc_invoices WHERE id = ?', id);
    need(row, 'That invoice does not exist.');
    need(row.customer_email, 'This customer has no email address.');
    const inv = withTotals(row);
    const { company, currency } = loadConfig();
    const money = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(n);
    const quote = inv.kind === 'quote';
    const body = [
      `Dear ${inv.customer_name},`, '', `Please find ${quote ? 'our quote' : 'invoice'} ${inv.number} from ${company.name} below.`, '',
      ...inv.items.map((x) => `${x.desc} — ${x.qty} x ${money(x.price)} = ${money(x.qty * x.price)}`), '',
      `Subtotal: ${money(inv.subtotal)}`, `VAT (${inv.vat_rate}%): ${money(inv.vat)}`, `${quote ? 'Total' : 'Total due'}: ${money(inv.total)}`,
      `${quote ? 'Valid until' : 'Due by'}: ${new Date(inv.due_at).toLocaleDateString('en-GB', { dateStyle: 'long' })}`, '', 'Thank you,', u.name,
    ].join('\n');
    const { delivery } = await sendMail(u, { to: [inv.customer_email], subject: `${quote ? 'Quote' : 'Invoice'} ${inv.number} from ${company.name}`, body });
    const failed = delivery.find((d) => d.status === 'failed');
    need(!failed, `The email was not delivered. ${failed?.detail ?? ''}`);
    run("UPDATE acc_invoices SET status = 'sent' WHERE id = ? AND status = 'draft'", id);
    return { delivery };
  },

  'acc.setStatus': (u, { id, status }: { id: string; status: string }) => {
    const inv = get<Invoice>('SELECT * FROM acc_invoices WHERE id = ?', id);
    need(inv, 'That invoice does not exist.');
    need((inv.kind === 'quote' ? ['draft', 'sent', 'accepted', 'declined'] : ['draft', 'sent', 'paid']).includes(status), 'Unknown status.');
    run('UPDATE acc_invoices SET status = ?, paid_at = ? WHERE id = ?', status, status === 'paid' ? (inv.status === 'paid' ? (inv as Invoice & { paid_at: number | null }).paid_at ?? Date.now() : Date.now()) : null, id);
    if (status === 'paid' && inv.status !== 'paid') emit({ type: 'acc.invoice.paid', app: 'accounting', userId: u.id, summary: `Invoice ${inv.number} was paid`, payload: { invoiceId: id } });
  },

  /** Turn a quote the customer agreed to into a draft invoice with the same lines. */
  'acc.convertQuote': (u, { id }: { id: string }) => {
    const q = get<Invoice>("SELECT * FROM acc_invoices WHERE id = ? AND kind = 'quote'", id);
    need(q, 'That quote does not exist.');
    const made = accounting['acc.createInvoice'](u, { contact_id: q.contact_id, customer_name: q.customer_name, customer_email: q.customer_email, items: JSON.parse(q.items), vat_rate: q.vat_rate }) as { id: string; number: string };
    run("UPDATE acc_invoices SET status = 'accepted' WHERE id = ?", id);
    return made;
  },

  /** Email a payment reminder for an invoice that is waiting to be paid. */
  'acc.remind': async (u, { id }: { id: string }) => {
    const row = get<Invoice>("SELECT * FROM acc_invoices WHERE id = ? AND kind = 'invoice'", id);
    need(row?.status === 'sent', 'Only invoices that are waiting to be paid can be chased.');
    need(row.customer_email, 'This customer has no email address.');
    const inv = withTotals(row);
    const { company, currency } = loadConfig();
    const total = new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(inv.total);
    const due = new Date(inv.due_at).toLocaleDateString('en-GB', { dateStyle: 'long' });
    const late = inv.due_at < Date.now();
    const body = [`Dear ${inv.customer_name},`, '', late
      ? `Our records show that invoice ${inv.number} for ${total} was due on ${due} and has not been paid yet.`
      : `This is a friendly reminder that invoice ${inv.number} for ${total} is due on ${due}.`,
      '', 'If you have already paid, please ignore this message. Otherwise we would be grateful if you could arrange payment.', '', 'Thank you,', u.name, company.name].join('\n');
    const { delivery } = await sendMail(u, { to: [inv.customer_email], subject: `Reminder: invoice ${inv.number} from ${company.name}`, body });
    const failed = delivery.find((d) => d.status === 'failed');
    need(!failed, `The reminder was not delivered. ${failed?.detail ?? ''}`);
    run('UPDATE acc_invoices SET reminded_at = ? WHERE id = ?', Date.now(), id);
  },

  'acc.removeInvoice': (_u, { id }: { id: string }) => {
    const inv = get<Invoice>('SELECT * FROM acc_invoices WHERE id = ?', id);
    need(inv?.status === 'draft', 'Only draft invoices can be deleted.');
    run('DELETE FROM acc_invoices WHERE id = ?', id);
  },

  'acc.expenses': () => all('SELECT * FROM acc_expenses ORDER BY spent_at DESC'),

  'acc.addExpense': (_u, e: { vendor: string; description?: string; category?: string; amount: number; vat?: number; spent_at?: number }) => {
    need(e.vendor?.trim(), 'Who was paid?');
    need(Number(e.amount) > 0, 'Enter the amount.');
    run('INSERT INTO acc_expenses (id, vendor, description, category, amount, vat, spent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), e.vendor.trim(), e.description ?? '', e.category || 'Other', Number(e.amount), Number(e.vat) || 0, e.spent_at ?? Date.now(), Date.now());
  },

  'acc.removeExpense': (_u, { id }: { id: string }) => {
    run("UPDATE acc_bank_lines SET match_kind = NULL, match_id = NULL WHERE match_kind = 'expense' AND match_id = ?", id);
    run('DELETE FROM acc_expenses WHERE id = ?', id);
  },

  /** Profit and VAT position. Draft invoices do not count until they are sent. */
  'acc.summary': () => {
    const invoices = all<Invoice>("SELECT * FROM acc_invoices WHERE kind = 'invoice' AND status != 'draft'").map(withTotals);
    const ex = get<{ amount: number | null; vat: number | null }>('SELECT SUM(amount) AS amount, SUM(vat) AS vat FROM acc_expenses')!;
    const revenue = round(invoices.reduce((s, i) => s + i.subtotal, 0));
    const vatCollected = round(invoices.reduce((s, i) => s + i.vat, 0));
    const expenses = round(ex.amount ?? 0);
    const vatPaid = round(ex.vat ?? 0);
    return {
      currency: loadConfig().currency,
      revenue, expenses, profit: round(revenue - expenses),
      vatCollected, vatPaid, vatDue: round(vatCollected - vatPaid),
      outstanding: round(invoices.filter((i) => i.status === 'sent').reduce((s, i) => s + i.total, 0)),
      overdue: round(invoices.filter((i) => i.status === 'sent' && i.due_at < Date.now()).reduce((s, i) => s + i.total, 0)),
    };
  },
};

// ---------- Recurring invoices and automatic reminders ----------
type Recurring = { id: string; contact_id: string | null; customer_name: string; customer_email: string; items: string; vat_rate: number; every: Every; due_days: number; next_at: number; auto_send: number; active: number; created_by: string; last_at: number | null };
type Every = 'week' | 'month' | 'quarter' | 'year';
const EVERY: Every[] = ['week', 'month', 'quarter', 'year'];

/** The same day in a later period, clamped to the end of shorter months (31 Jan + 1 month = 28/29 Feb). */
export function advance(ts: number, every: Every): number {
  const d = new Date(ts);
  if (every === 'week') { d.setDate(d.getDate() + 7); return d.getTime(); }
  const months = every === 'month' ? 1 : every === 'quarter' ? 3 : 12;
  const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.getTime();
}

const setting = (key: string) => get<{ value: string }>('SELECT value FROM acc_settings WHERE key = ?', key)?.value;
const adminUser = (): User | undefined => listUsers().find((u) => u.role === 'admin') ?? listUsers()[0];

Object.assign(accounting, {
  'acc.recurring': () => all<Recurring>('SELECT * FROM acc_recurring ORDER BY active DESC, next_at').map((r) => {
    const items = JSON.parse(r.items) as Item[];
    const subtotal = round(net(items));
    return { ...r, items, subtotal, total: round(subtotal * (1 + r.vat_rate / 100)), made: get<{ n: number }>('SELECT COUNT(*) AS n FROM acc_invoices WHERE recurring_id = ?', r.id)!.n };
  }),

  'acc.saveRecurring': (u: User, r: { id?: string; contact_id?: string; customer_name: string; customer_email?: string; items: Item[]; vat_rate: number; every: Every; due_days?: number; next_at: number; auto_send?: boolean; active?: boolean }) => {
    need(r.customer_name?.trim(), 'Who is the invoice for?');
    const items = (r.items ?? []).map((x) => ({ desc: String(x.desc ?? '').trim(), qty: Number(x.qty) || 0, price: Number(x.price) || 0 })).filter((x) => x.desc && x.qty);
    need(items.length, 'Add at least one line with a description and a quantity.');
    need(EVERY.includes(r.every), 'Choose how often to invoice.');
    need(Number(r.next_at) > 0, 'Choose the date of the first invoice.');
    if (r.auto_send) need(r.customer_email?.trim(), 'Add the customer’s email address to send invoices automatically.');
    const v = [r.contact_id || null, r.customer_name.trim(), (r.customer_email ?? '').trim().toLowerCase(), JSON.stringify(items), Number(r.vat_rate) || 0, r.every, Math.max(0, Math.min(120, Number(r.due_days ?? 14))), Number(r.next_at), r.auto_send ? 1 : 0, r.active === false ? 0 : 1];
    if (r.id) {
      run('UPDATE acc_recurring SET contact_id = ?, customer_name = ?, customer_email = ?, items = ?, vat_rate = ?, every = ?, due_days = ?, next_at = ?, auto_send = ?, active = ? WHERE id = ?', ...v, r.id);
      return { id: r.id };
    }
    const id = crypto.randomUUID();
    run('INSERT INTO acc_recurring (contact_id, customer_name, customer_email, items, vat_rate, every, due_days, next_at, auto_send, active, id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ...v, id, u.id, Date.now());
    emit({ type: 'acc.recurring.created', app: 'accounting', userId: u.id, summary: `Recurring invoice set up for ${r.customer_name.trim()} (every ${r.every})`, payload: { recurringId: id } });
    return { id };
  },

  'acc.removeRecurring': (_u: User, { id }: { id: string }) => { run('DELETE FROM acc_recurring WHERE id = ?', id); },

  'acc.settings': () => ({ autoRemind: setting('autoRemind') === '1' }),
  'acc.saveSettings': (u: User, { autoRemind }: { autoRemind: boolean }) => {
    need(u.role === 'admin', 'Only an admin can change this.');
    run("INSERT INTO acc_settings (key, value) VALUES ('autoRemind', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", autoRemind ? '1' : '0');
  },
} satisfies Handlers);

/** Make due recurring invoices, and chase overdue ones if automatic reminders are on. Safe to call often. */
export async function runAccountingJobs(now = Date.now()): Promise<{ made: number; sent: number; reminded: number }> {
  const out = { made: 0, sent: 0, reminded: 0 };
  for (const r of all<Recurring>('SELECT * FROM acc_recurring WHERE active = 1 AND next_at <= ?', now)) {
    const owner = listUsers().find((u) => u.id === r.created_by) ?? adminUser();
    if (!owner) break;
    // Move the date on first, so a failure while sending can never create the same invoice twice.
    run('UPDATE acc_recurring SET next_at = ?, last_at = ? WHERE id = ? AND next_at = ?', advance(r.next_at, r.every), now, r.id, r.next_at);
    const made = accounting['acc.createInvoice'](owner, { contact_id: r.contact_id ?? undefined, customer_name: r.customer_name, customer_email: r.customer_email, items: JSON.parse(r.items), vat_rate: r.vat_rate, dueDays: r.due_days }) as { id: string; number: string };
    run('UPDATE acc_invoices SET recurring_id = ?, issued_at = ?, due_at = ? WHERE id = ?', r.id, r.next_at, r.next_at + r.due_days * 864e5, made.id);
    out.made++;
    if (r.auto_send && r.customer_email) {
      try { await accounting['acc.sendInvoice'](owner, { id: made.id }); out.sent++; }
      catch (err) { emit({ type: 'acc.recurring.failed', app: 'accounting', userId: owner.id, summary: `Invoice ${made.number} was made but could not be emailed: ${(err as Error).message}`, payload: { invoiceId: made.id } }); }
    }
  }
  if (setting('autoRemind') === '1') {
    const admin = adminUser();
    // Chase three days after the due date, then once a week, at most four times.
    const late = all<{ id: string; created_at: number }>(
      "SELECT id, created_at FROM acc_invoices WHERE kind = 'invoice' AND status = 'sent' AND customer_email != '' AND due_at < ? AND (reminded_at IS NULL OR reminded_at < ?) AND due_at > ?",
      now - 3 * 864e5, now - 7 * 864e5, now - 35 * 864e5);
    for (const i of late) {
      if (!admin) break;
      try { await accounting['acc.remind'](admin, { id: i.id }); out.reminded++; } catch { /* tried again next run */ }
    }
  }
  return out;
}

export function scheduleAccounting(): void {
  const store = globalThis as typeof globalThis & { __databagAccTimer?: ReturnType<typeof setInterval> };
  if (store.__databagAccTimer) return;
  const tick = () => runAccountingJobs().catch((err) => console.error('databag: accounting jobs failed:', err.message));
  setTimeout(tick, 30_000);
  store.__databagAccTimer = setInterval(tick, 15 * 60_000);
  store.__databagAccTimer.unref?.();
}
