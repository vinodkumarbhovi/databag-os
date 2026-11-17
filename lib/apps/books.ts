import crypto from 'node:crypto';
import type { User } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { type Handlers, need } from '../rpc.ts';

/**
 * Double-entry books. Invoices, payments and expenses post themselves, so the books
 * can never drift from Accounting; manual journal entries cover everything else
 * (opening balance, owner money, VAT payments, corrections). Every entry balances.
 */
export const ACCOUNTS = [
  { code: '1000', name: 'Bank', type: 'asset' },
  { code: '1100', name: 'Money owed by customers', type: 'asset' },
  { code: '1200', name: 'VAT to reclaim', type: 'asset' },
  { code: '1500', name: 'Equipment', type: 'asset' },
  { code: '2000', name: 'Money owed to suppliers', type: 'liability' },
  { code: '2100', name: 'VAT charged to customers', type: 'liability' },
  { code: '2200', name: 'Loans', type: 'liability' },
  { code: '3000', name: 'Owner’s money', type: 'equity' },
  { code: '4000', name: 'Sales', type: 'income' },
  { code: '4900', name: 'Other income', type: 'income' },
  { code: '5000', name: 'Software', type: 'expense' },
  { code: '5010', name: 'Office', type: 'expense' },
  { code: '5020', name: 'Travel', type: 'expense' },
  { code: '5030', name: 'Marketing', type: 'expense' },
  { code: '5040', name: 'Salaries', type: 'expense' },
  { code: '5050', name: 'Professional fees', type: 'expense' },
  { code: '5060', name: 'Equipment', type: 'expense' },
  { code: '5070', name: 'Bank fees', type: 'expense' },
  { code: '5090', name: 'Other expenses', type: 'expense' },
] as const;
const CATEGORY_ACCOUNT: Record<string, string> = { Software: '5000', Office: '5010', Travel: '5020', Marketing: '5030', Salaries: '5040', 'Professional fees': '5050', Equipment: '5060', 'Bank fees': '5070', Other: '5090' };
const isAccount = (code: string) => ACCOUNTS.some((a) => a.code === code);
const round = (n: number) => Math.round(n * 100) / 100;

type Line = { account: string; debit: number; credit: number };
export type Entry = { id: string; date: number; memo: string; source: 'invoice' | 'payment' | 'expense' | 'journal'; ref: string; lines: Line[] };
type Inv = { id: string; number: string; customer_name: string; items: string; vat_rate: number; status: string; issued_at: number; paid_at: number | null };
type Exp = { id: string; vendor: string; description: string; category: string; amount: number; vat: number; spent_at: number };

const invoiceTotals = (i: Inv) => {
  const net = round((JSON.parse(i.items) as { qty: number; price: number }[]).reduce((s, x) => s + x.qty * x.price, 0));
  const vat = round((net * i.vat_rate) / 100);
  return { net, vat, total: round(net + vat) };
};

/** Every entry in the books, oldest first. */
export function entries(): Entry[] {
  const out: Entry[] = [];
  for (const i of all<Inv>("SELECT id, number, customer_name, items, vat_rate, status, issued_at, paid_at FROM acc_invoices WHERE kind = 'invoice' AND status IN ('sent', 'paid')")) {
    const t = invoiceTotals(i);
    out.push({ id: `inv-${i.id}`, date: i.issued_at, memo: `Invoice ${i.number}, ${i.customer_name}`, source: 'invoice', ref: i.id, lines: [
      { account: '1100', debit: t.total, credit: 0 }, { account: '4000', debit: 0, credit: t.net }, ...(t.vat ? [{ account: '2100', debit: 0, credit: t.vat }] : []),
    ] });
    if (i.status === 'paid') out.push({ id: `pay-${i.id}`, date: i.paid_at ?? i.issued_at, memo: `Payment for ${i.number}, ${i.customer_name}`, source: 'payment', ref: i.id, lines: [
      { account: '1000', debit: t.total, credit: 0 }, { account: '1100', debit: 0, credit: t.total },
    ] });
  }
  for (const e of all<Exp>('SELECT * FROM acc_expenses')) {
    out.push({ id: `exp-${e.id}`, date: e.spent_at, memo: `${e.vendor}${e.description ? `, ${e.description}` : ''}`, source: 'expense', ref: e.id, lines: [
      { account: CATEGORY_ACCOUNT[e.category] ?? '5090', debit: round(e.amount), credit: 0 }, ...(e.vat ? [{ account: '1200', debit: round(e.vat), credit: 0 }] : []),
      { account: '1000', debit: 0, credit: round(e.amount + e.vat) },
    ] });
  }
  for (const j of all<{ id: string; date: number; memo: string; lines: string }>('SELECT * FROM acc_journal'))
    out.push({ id: `jnl-${j.id}`, date: j.date, memo: j.memo, source: 'journal', ref: j.id, lines: JSON.parse(j.lines) });
  return out.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
}

/** Debit-minus-credit per account for entries in [from, to). */
function totals(list: Entry[], from = 0, to = Infinity): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of list) if (e.date >= from && e.date < to) for (const l of e.lines) m.set(l.account, round((m.get(l.account) ?? 0) + l.debit - l.credit));
  return m;
}
/** Balances in their natural sign: assets and expenses as debits, the rest as credits. */
const natural = (code: string, dr: number) => (['asset', 'expense'].includes(ACCOUNTS.find((a) => a.code === code)!.type) ? dr : -dr);

// ---------- Bank statements ----------
type BankLine = { id: string; date: number; description: string; amount: number; match_kind: string | null; match_id: string | null; ignored: number };

/** Split CSV text into rows, respecting quotes. The delimiter is guessed from the first line. */
export function parseCsv(text: string): string[][] {
  // Some exports start with a note before the header, so judge by the busiest of the first lines.
  const lines = text.split(/\r?\n/, 10);
  const score = (d: string) => Math.max(...lines.map((l) => l.split(d).length));
  const delim = [',', ';', '\t'].sort((a, b) => score(b) - score(a))[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some((c) => c)) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

/** "1.234,56", "1,234.56", "-12.5", "(40.00)" and "€ 12" all become numbers. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d,.\-()+]/g, '');
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-') || /-$/.test(s);
  s = s.replace(/[()+-]/g, '');
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

/** ISO dates, 20261114, and day-first dates such as 14/11/2026 (month-first when the day cannot be a month). */
export function parseDate(raw: string): number | null {
  const s = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime();
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (!m) return null;
  let [a, b] = [+m[1], +m[2]];
  if (b > 12 && a <= 12) [a, b] = [b, a];
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  if (b < 1 || b > 12 || a < 1 || a > 31) return null;
  return new Date(y, b - 1, a, 12).getTime();
}

export function readStatement(text: string): { date: number; description: string; amount: number }[] {
  const rows = parseCsv(text);
  need(rows.length >= 2, 'That file has no rows to import.');
  const headerAt = rows.findIndex((r) => r.some((c) => /date|datum|fecha|booking/i.test(c)));
  need(headerAt >= 0, 'Could not find a header row with a date column.');
  const head = rows[headerAt].map((c) => c.toLowerCase());
  const col = (re: RegExp) => head.findIndex((c) => re.test(c));
  const date = col(/date|datum|fecha|booking/);
  const desc = col(/desc|detail|payee|name|memo|narrative|omschrijving|naam|text|reference|counterparty/);
  const amount = col(/^amount|amount|bedrag|value|betrag|importe/);
  const debit = col(/debit|paid out|withdrawal|money out|^out/);
  const credit = col(/credit|paid in|deposit|money in|^in$/);
  need(amount >= 0 || (debit >= 0 && credit >= 0), 'Could not find an amount column (or separate money in and money out columns).');
  const out = [];
  for (const r of rows.slice(headerAt + 1)) {
    const d = parseDate(r[date] ?? '');
    let a = amount >= 0 ? parseAmount(r[amount] ?? '') : null;
    if (amount < 0) { const inn = parseAmount(r[credit] ?? '') ?? 0, outt = parseAmount(r[debit] ?? '') ?? 0; a = round(Math.abs(inn) - Math.abs(outt)); }
    if (d === null || a === null || a === 0) continue;
    out.push({ date: d, description: (desc >= 0 ? r[desc] : r.filter((_, i) => i !== date && i !== amount).join(' ')).slice(0, 300) || 'Bank line', amount: round(a) });
  }
  need(out.length, 'No lines with a date and an amount were found.');
  return out;
}

/** Likely matches for an unmatched bank line: an unpaid invoice for money in, an unbanked expense for money out. */
function suggestions(line: BankLine) {
  if (line.amount > 0) {
    return all<Inv & { due_at: number; customer_email: string }>("SELECT * FROM acc_invoices WHERE kind = 'invoice' AND status = 'sent'")
      .map((i) => ({ i, t: invoiceTotals(i) }))
      .filter(({ t }) => Math.abs(t.total - line.amount) < 0.01)
      .sort((a, b) => Math.abs(a.i.due_at - line.date) - Math.abs(b.i.due_at - line.date))
      .slice(0, 3).map(({ i, t }) => ({ kind: 'invoice', id: i.id, label: `Invoice ${i.number}, ${i.customer_name}`, amount: t.total }));
  }
  return all<Exp>('SELECT * FROM acc_expenses WHERE bank_line_id IS NULL AND ABS(spent_at - ?) < ?', line.date, 21 * 864e5)
    .filter((e) => Math.abs(round(e.amount + e.vat) + line.amount) < 0.01)
    .sort((a, b) => Math.abs(a.spent_at - line.date) - Math.abs(b.spent_at - line.date))
    .slice(0, 3).map((e) => ({ kind: 'expense', id: e.id, label: `Expense: ${e.vendor}${e.description ? `, ${e.description}` : ''}`, amount: -round(e.amount + e.vat) }));
}

const lineById = (id: string) => { const l = get<BankLine>('SELECT * FROM acc_bank_lines WHERE id = ?', id); need(l, 'That bank line does not exist.'); return l; };
const adminOnly = (u: User) => need(u.role === 'admin', 'Only an admin can change the books.');

export const books: Handlers = {
  'books.accounts': () => {
    const t = totals(entries());
    return { currency: loadConfig().currency, accounts: ACCOUNTS.map((a) => ({ ...a, balance: natural(a.code, t.get(a.code) ?? 0) })) };
  },

  'books.ledger': (_u, { account }: { account: string }) => {
    need(isAccount(account), 'Unknown account.');
    let running = 0;
    const rows = [];
    for (const e of entries()) for (const l of e.lines) if (l.account === account) {
      running = round(running + natural(account, l.debit - l.credit));
      rows.push({ id: e.id, date: e.date, memo: e.memo, source: e.source, ref: e.ref, debit: l.debit, credit: l.credit, balance: running });
    }
    return { currency: loadConfig().currency, rows: rows.reverse().slice(0, 500) };
  },

  /** Profit and loss for a period, and the balance sheet at its end. */
  'books.reports': (_u, { from, to }: { from: number; to: number }) => {
    const list = entries();
    const pl = totals(list, from, to), bs = totals(list, 0, to);
    const pick = (m: Map<string, number>, type: string) => ACCOUNTS.filter((a) => a.type === type).map((a) => ({ code: a.code, name: a.name, amount: natural(a.code, m.get(a.code) ?? 0) })).filter((a) => a.amount !== 0);
    const income = pick(pl, 'income'), expenses = pick(pl, 'expense');
    const sum = (l: { amount: number }[]) => round(l.reduce((s, x) => s + x.amount, 0));
    const assets = pick(bs, 'asset'), liabilities = pick(bs, 'liability'), equity = pick(bs, 'equity');
    const earnings = round(sum(pick(bs, 'income')) - sum(pick(bs, 'expense')));
    const unbalanced = list.filter((e) => Math.abs(e.lines.reduce((s, l) => s + l.debit - l.credit, 0)) > 0.005).length;
    return {
      currency: loadConfig().currency,
      profitAndLoss: { income, expenses, totalIncome: sum(income), totalExpenses: sum(expenses), profit: round(sum(income) - sum(expenses)) },
      balanceSheet: { assets, liabilities, equity: [...equity, { code: '', name: 'Profit kept in the business', amount: earnings }], totalAssets: sum(assets), totalLiabilities: sum(liabilities), totalEquity: round(sum(equity) + earnings) },
      checks: { balanced: Math.abs(sum(assets) - sum(liabilities) - sum(equity) - earnings) < 0.01 && unbalanced === 0 },
    };
  },

  'books.journal': () => all<{ id: string; date: number; memo: string; lines: string }>('SELECT * FROM acc_journal ORDER BY date DESC').map((j) => ({ ...j, lines: JSON.parse(j.lines) as Line[] })),

  'books.addJournal': (u, j: { date: number; memo: string; lines: Line[] }) => {
    adminOnly(u);
    need(j.memo?.trim(), 'Describe the entry.');
    need(Number(j.date) > 0, 'Choose a date.');
    const lines = (j.lines ?? []).map((l) => ({ account: String(l.account), debit: round(Math.max(0, Number(l.debit) || 0)), credit: round(Math.max(0, Number(l.credit) || 0)) })).filter((l) => l.debit || l.credit);
    need(lines.length >= 2, 'An entry needs at least two lines.');
    need(lines.every((l) => isAccount(l.account)), 'Choose an account for every line.');
    need(lines.every((l) => !(l.debit && l.credit)), 'A line is either a debit or a credit, not both.');
    const dr = round(lines.reduce((s, l) => s + l.debit, 0)), cr = round(lines.reduce((s, l) => s + l.credit, 0));
    need(Math.abs(dr - cr) < 0.005, `Debits (${dr}) and credits (${cr}) must be equal.`);
    const id = crypto.randomUUID();
    run('INSERT INTO acc_journal (id, date, memo, lines, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, Number(j.date), j.memo.trim().slice(0, 300), JSON.stringify(lines), u.id, Date.now());
    return { id };
  },
  'books.removeJournal': (u, { id }: { id: string }) => {
    adminOnly(u);
    run("UPDATE acc_bank_lines SET match_kind = NULL, match_id = NULL WHERE match_kind = 'journal' AND match_id = ?", id);
    run('DELETE FROM acc_journal WHERE id = ?', id);
  },

  'books.importBank': (u, { csv }: { csv: string }) => {
    adminOnly(u);
    need(typeof csv === 'string' && csv.length < 5_000_000, 'That file is too large.');
    const seen = new Map<string, number>();
    let added = 0, skipped = 0;
    for (const l of readStatement(csv)) {
      // The same date, amount and text twice in one file are two real payments; on re-import they are skipped.
      const key = `${new Date(l.date).toISOString().slice(0, 10)}|${l.amount}|${l.description}`;
      const n = (seen.get(key) ?? 0) + 1; seen.set(key, n);
      const fingerprint = crypto.createHash('sha256').update(`${key}|${n}`).digest('hex');
      if (get('SELECT 1 FROM acc_bank_lines WHERE fingerprint = ?', fingerprint)) { skipped++; continue; }
      run('INSERT INTO acc_bank_lines (id, date, description, amount, fingerprint, imported_at) VALUES (?, ?, ?, ?, ?, ?)', crypto.randomUUID(), l.date, l.description, l.amount, fingerprint, Date.now());
      added++;
    }
    emit({ type: 'books.bank.imported', app: 'accounting', userId: u.id, summary: `Imported ${added} bank line${added === 1 ? '' : 's'}`, payload: {} });
    return { added, skipped };
  },

  'books.bank': () => {
    const lines = all<BankLine>('SELECT * FROM acc_bank_lines ORDER BY date DESC, imported_at DESC LIMIT 1000');
    const open = lines.filter((l) => !l.match_kind && !l.ignored);
    const ledgerBank = natural('1000', totals(entries()).get('1000') ?? 0);
    const statement = round(all<{ amount: number }>('SELECT amount FROM acc_bank_lines WHERE ignored = 0').reduce((s, l) => s + l.amount, 0));
    return {
      currency: loadConfig().currency,
      summary: { lines: lines.length, open: open.length, statement, ledgerBank, difference: round(statement - ledgerBank) },
      lines: lines.map((l) => ({ ...l, suggestions: !l.match_kind && !l.ignored ? suggestions(l) : [] })),
    };
  },

  /** Confirm that a bank line is a customer's payment, or an expense already entered. */
  'books.match': (u, { lineId, kind, id }: { lineId: string; kind: 'invoice' | 'expense'; id: string }) => {
    adminOnly(u);
    const line = lineById(lineId);
    need(!line.match_kind, 'This bank line is already matched.');
    if (kind === 'invoice') {
      const inv = get<Inv>("SELECT * FROM acc_invoices WHERE id = ? AND kind = 'invoice'", id);
      need(inv && inv.status === 'sent', 'Only invoices waiting to be paid can be matched.');
      need(Math.abs(invoiceTotals(inv).total - line.amount) < 0.01, 'The amounts do not match.');
      run("UPDATE acc_invoices SET status = 'paid', paid_at = ? WHERE id = ?", line.date, id);
      emit({ type: 'acc.invoice.paid', app: 'accounting', userId: u.id, summary: `Invoice ${inv.number} was paid (matched to the bank)`, payload: { invoiceId: id } });
    } else {
      const e = get<Exp & { bank_line_id: string | null }>('SELECT * FROM acc_expenses WHERE id = ?', id);
      need(e && !e.bank_line_id, 'That expense is already matched.');
      need(Math.abs(round(e.amount + e.vat) + line.amount) < 0.01, 'The amounts do not match.');
      run('UPDATE acc_expenses SET bank_line_id = ? WHERE id = ?', lineId, id);
    }
    run('UPDATE acc_bank_lines SET match_kind = ?, match_id = ? WHERE id = ?', kind, id, lineId);
  },

  /** Book a bank line that has nothing to match: money out as an expense, anything else as a journal entry. */
  'books.bookLine': (u, b: { lineId: string; as: 'expense' | 'journal'; vendor?: string; category?: string; vat?: number; account?: string }) => {
    adminOnly(u);
    const line = lineById(b.lineId);
    need(!line.match_kind, 'This bank line is already matched.');
    if (b.as === 'expense') {
      need(line.amount < 0, 'Only money going out can be an expense.');
      const vat = round(Math.max(0, Number(b.vat) || 0));
      need(vat < -line.amount, 'The VAT must be less than the amount paid.');
      const id = crypto.randomUUID();
      run('INSERT INTO acc_expenses (id, vendor, description, category, amount, vat, spent_at, created_at, bank_line_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, (b.vendor?.trim() || line.description).slice(0, 120), line.description, b.category && CATEGORY_ACCOUNT[b.category] ? b.category : 'Other', round(-line.amount - vat), vat, line.date, Date.now(), line.id);
      run("UPDATE acc_bank_lines SET match_kind = 'expense', match_id = ? WHERE id = ?", id, line.id);
      return { id };
    }
    need(b.account && isAccount(b.account) && b.account !== '1000', 'Choose the account the money came from or went to.');
    const amt = Math.abs(line.amount);
    const lines = line.amount > 0 ? [{ account: '1000', debit: amt, credit: 0 }, { account: b.account, debit: 0, credit: amt }] : [{ account: b.account, debit: amt, credit: 0 }, { account: '1000', debit: 0, credit: amt }];
    const id = crypto.randomUUID();
    run('INSERT INTO acc_journal (id, date, memo, lines, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, line.date, line.description.slice(0, 300), JSON.stringify(lines), u.id, Date.now());
    run("UPDATE acc_bank_lines SET match_kind = 'journal', match_id = ? WHERE id = ?", id, line.id);
    return { id };
  },

  'books.unmatch': (u, { lineId }: { lineId: string }) => {
    adminOnly(u);
    const line = lineById(lineId);
    if (line.match_kind === 'invoice') run("UPDATE acc_invoices SET status = 'sent', paid_at = NULL WHERE id = ? AND paid_at = ?", line.match_id, line.date);
    if (line.match_kind === 'expense') run('UPDATE acc_expenses SET bank_line_id = NULL WHERE id = ?', line.match_id);
    if (line.match_kind === 'journal') run('DELETE FROM acc_journal WHERE id = ?', line.match_id);
    run('UPDATE acc_bank_lines SET match_kind = NULL, match_id = NULL WHERE id = ?', lineId);
  },

  'books.ignore': (u, { lineId, ignored }: { lineId: string; ignored: boolean }) => {
    adminOnly(u);
    need(!lineById(lineId).match_kind, 'Unmatch the line first.');
    run('UPDATE acc_bank_lines SET ignored = ? WHERE id = ?', ignored ? 1 : 0, lineId);
  },

  'books.removeBankLine': (u, { lineId }: { lineId: string }) => {
    adminOnly(u);
    need(!lineById(lineId).match_kind, 'Unmatch the line first.');
    run('DELETE FROM acc_bank_lines WHERE id = ?', lineId);
  },
};
