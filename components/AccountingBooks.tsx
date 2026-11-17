'use client';

import { Check, Pause, Play, Plus, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { money, rpc } from '@/lib/client';
import { Field, Modal } from './ui';

type Attempt = (action: () => Promise<unknown>, done?: string) => Promise<boolean>;
type Contact = { id: string; name: string; email: string };
const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateInput = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromInput = (s: string) => new Date(`${s}T12:00`).getTime();
const EVERY: Record<string, string> = { week: 'Every week', month: 'Every month', quarter: 'Every quarter', year: 'Every year' };
const CATEGORIES = ['Software', 'Office', 'Travel', 'Marketing', 'Salaries', 'Professional fees', 'Equipment', 'Bank fees', 'Other'];

// ---------- Recurring ----------
type Item = { desc: string; qty: string | number; price: string | number };
type Recurring = { id?: string; contact_id?: string | null; customer_name: string; customer_email: string; items: Item[]; vat_rate: number | string; every: string; due_days: number; next_at: number; auto_send: number | boolean; active: number | boolean; total?: number; made?: number; last_at?: number | null };

export function RecurringTab({ cur, contacts, attempt, reload }: { cur: string; contacts: Contact[]; attempt: Attempt; reload: () => void }) {
  const [list, setList] = useState<Recurring[]>([]);
  const [edit, setEdit] = useState<(Recurring & { start: string }) | null>(null);
  const load = useCallback(() => rpc<Recurring[]>('acc.recurring').then(setList).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    const { start, ...r } = edit!;
    if (await attempt(() => rpc('acc.saveRecurring', { ...r, next_at: fromInput(start), auto_send: !!r.auto_send, active: !!r.active }), 'Saved.')) { setEdit(null); load(); reload(); }
  };
  const setItem = (i: number, k: keyof Item, v: string) => setEdit({ ...edit!, items: edit!.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const pick = (id: string) => { const c = contacts.find((x) => x.id === id); setEdit({ ...edit!, contact_id: id, customer_name: c?.name ?? edit!.customer_name, customer_email: c?.email ?? edit!.customer_email }); };

  return (
    <>
      <div className="spread" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0 }}>Invoices made for you on a schedule: retainers, subscriptions, rent. Each one appears under Invoices on its date, and can be emailed straight away.</p>
        <button className="btn primary" onClick={() => setEdit({ customer_name: '', customer_email: '', items: [{ desc: '', qty: 1, price: '' }], vat_rate: 21, every: 'month', due_days: 14, next_at: Date.now(), auto_send: false, active: true, start: dateInput(Date.now()) })}><Plus size={15} /> Recurring invoice</button>
      </div>
      {list.length === 0 ? <div className="empty">No recurring invoices yet.</div> : (
        <table className="table">
          <thead><tr><th>Customer</th><th>How often</th><th>Next invoice</th><th>Sending</th><th className="num">Total</th><th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                <td>{r.customer_name}<div className="muted small">{r.made} made so far</div></td>
                <td>{EVERY[r.every]}</td>
                <td className="muted">{r.active ? day(r.next_at) : 'Paused'}</td>
                <td><span className={`badge ${r.auto_send ? 'info' : ''}`}>{r.auto_send ? 'emailed automatically' : 'saved as draft'}</span></td>
                <td className="num">{money(r.total ?? 0, cur)}</td>
                <td className="acts">
                  <button className="btn ghost icon" title={r.active ? 'Pause' : 'Resume'} aria-label={r.active ? 'Pause' : 'Resume'} onClick={async () => { if (await attempt(() => rpc('acc.saveRecurring', { ...r, active: !r.active, auto_send: !!r.auto_send }))) load(); }}>{r.active ? <Pause size={15} /> : <Play size={15} />}</button>
                  <button className="btn" onClick={() => setEdit({ ...r, start: dateInput(r.next_at) })}>Edit</button>
                  <button className="btn ghost icon" aria-label="Delete" onClick={async () => { if (window.confirm(`Stop invoicing ${r.customer_name} automatically? Invoices already made stay.`) && (await attempt(() => rpc('acc.removeRecurring', { id: r.id }), 'Deleted.'))) load(); }}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit recurring invoice' : 'New recurring invoice'} wide onClose={() => setEdit(null)}>
          {contacts.length > 0 && (
            <Field label="Customer from CRM">
              <select className="input" value={edit.contact_id ?? ''} onChange={(e) => pick(e.target.value)}><option value="">Someone else…</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </Field>
          )}
          <div className="two">
            <Field label="Customer name"><input className="input" value={edit.customer_name} onChange={(e) => setEdit({ ...edit, customer_name: e.target.value })} /></Field>
            <Field label="Customer email"><input className="input" type="email" value={edit.customer_email} onChange={(e) => setEdit({ ...edit, customer_email: e.target.value })} /></Field>
          </div>
          <span className="label">Lines</span>
          {edit.items.map((x, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 110px', gap: 8, marginBottom: 8 }}>
              <input className="input" placeholder="Description" aria-label="Description" value={x.desc} onChange={(e) => setItem(i, 'desc', e.target.value)} />
              <input className="input" type="number" min="0" aria-label="Quantity" value={x.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} />
              <input className="input" type="number" min="0" placeholder="Unit price" aria-label="Unit price" value={x.price} onChange={(e) => setItem(i, 'price', e.target.value)} />
            </div>
          ))}
          <button className="btn ghost" onClick={() => setEdit({ ...edit, items: [...edit.items, { desc: '', qty: 1, price: '' }] })}><Plus size={14} /> Add line</button>
          <div className="two" style={{ marginTop: 12 }}>
            <Field label="How often"><select className="input" value={edit.every} onChange={(e) => setEdit({ ...edit, every: e.target.value })}>{Object.entries(EVERY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Next invoice on"><input className="input" type="date" value={edit.start} onChange={(e) => setEdit({ ...edit, start: e.target.value })} /></Field>
            <Field label="VAT rate (%)"><input className="input" type="number" min="0" value={edit.vat_rate} onChange={(e) => setEdit({ ...edit, vat_rate: e.target.value })} /></Field>
            <Field label="Days to pay"><input className="input" type="number" min="0" max="120" value={edit.due_days} onChange={(e) => setEdit({ ...edit, due_days: Number(e.target.value) })} /></Field>
          </div>
          <label className="sign-agree"><input type="checkbox" checked={!!edit.auto_send} onChange={(e) => setEdit({ ...edit, auto_send: e.target.checked })} /> Email each invoice to the customer as soon as it is made</label>
          <p className="muted small" style={{ marginTop: 8 }}>Otherwise each invoice is saved as a draft for you to check and send.</p>
          <div className="modal-foot"><button className="btn primary" onClick={save}>Save</button></div>
        </Modal>
      )}
    </>
  );
}

// ---------- Books ----------
type Account = { code: string; name: string; type: string; balance: number };
type ReportLine = { code: string; name: string; amount: number };
type Reports = {
  profitAndLoss: { income: ReportLine[]; expenses: ReportLine[]; totalIncome: number; totalExpenses: number; profit: number };
  balanceSheet: { assets: ReportLine[]; liabilities: ReportLine[]; equity: ReportLine[]; totalAssets: number; totalLiabilities: number; totalEquity: number };
  checks: { balanced: boolean };
};
type LedgerRow = { id: string; date: number; memo: string; source: string; debit: number; credit: number; balance: number };
type JLine = { account: string; debit: string; credit: string };
const TYPE_NAMES: Record<string, string> = { asset: 'What the business owns', liability: 'What it owes', equity: 'Owner’s share', income: 'Income', expense: 'Expenses' };

export function BooksTab({ cur, attempt }: { cur: string; attempt: Attempt }) {
  const year = new Date().getFullYear();
  const [range, setRange] = useState({ from: `${year}-01-01`, to: dateInput(Date.now()) });
  const [reports, setReports] = useState<Reports | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ledger, setLedger] = useState<{ account: Account; rows: LedgerRow[] } | null>(null);
  const [journal, setJournal] = useState<{ date: string; memo: string; lines: JLine[] } | null>(null);
  const load = useCallback(() => {
    const to = fromInput(range.to) + 12 * 3_600_000;
    rpc<Reports>('books.reports', { from: new Date(`${range.from}T00:00`).getTime(), to }).then(setReports).catch(() => {});
    rpc<{ accounts: Account[] }>('books.accounts').then((d) => setAccounts(d.accounts)).catch(() => {});
  }, [range]);
  useEffect(() => { load(); }, [load]);
  const openLedger = async (code: string) => {
    const account = accounts.find((a) => a.code === code);
    if (account) setLedger({ account, rows: (await rpc<{ rows: LedgerRow[] }>('books.ledger', { account: code })).rows });
  };
  const saveJournal = async () => {
    const j = journal!;
    if (await attempt(() => rpc('books.addJournal', { date: fromInput(j.date), memo: j.memo, lines: j.lines }), 'Entry added.')) { setJournal(null); load(); }
  };
  const dr = journal ? journal.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0) : 0;
  const cr = journal ? journal.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0) : 0;
  const section = (title: string, lines: ReportLine[], total: number, totalLabel: string) => (
    <>
      <tr><td colSpan={2} className="muted small" style={{ paddingTop: 14 }}>{title}</td></tr>
      {lines.map((l) => <tr key={l.code + l.name} className={l.code ? 'click' : ''} onClick={() => l.code && openLedger(l.code)}><td className="indent">{l.name}</td><td className="num">{money(l.amount, cur)}</td></tr>)}
      {lines.length === 0 && <tr><td className="indent muted">Nothing yet</td><td /></tr>}
      <tr className="total"><td>{totalLabel}</td><td className="num">{money(total, cur)}</td></tr>
    </>
  );

  return (
    <>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted">From</span><input className="input" style={{ width: 160 }} type="date" aria-label="From" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <span className="muted">to</span><input className="input" style={{ width: 160 }} type="date" aria-label="To" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </div>
        <button className="btn" onClick={() => setJournal({ date: dateInput(Date.now()), memo: '', lines: [{ account: '1000', debit: '', credit: '' }, { account: '3000', debit: '', credit: '' }] })}><Plus size={15} /> Journal entry</button>
      </div>
      {reports && !reports.checks.balanced && <p className="notice">The books do not balance. This should not happen: check the most recent journal entries.</p>}
      {reports && (
        <div className="books-grid">
          <div>
            <h2 className="section">Profit and loss</h2>
            <table className="table"><tbody>
              {section('Income', reports.profitAndLoss.income, reports.profitAndLoss.totalIncome, 'Total income')}
              {section('Expenses', reports.profitAndLoss.expenses, reports.profitAndLoss.totalExpenses, 'Total expenses')}
              <tr className="total"><td>{reports.profitAndLoss.profit >= 0 ? 'Profit' : 'Loss'}</td><td className="num">{money(reports.profitAndLoss.profit, cur)}</td></tr>
            </tbody></table>
          </div>
          <div>
            <h2 className="section">Balance sheet on {day(fromInput(range.to))} {reports.checks.balanced && <span className="badge good">balances</span>}</h2>
            <table className="table"><tbody>
              {section(TYPE_NAMES.asset, reports.balanceSheet.assets, reports.balanceSheet.totalAssets, 'Total assets')}
              {section(TYPE_NAMES.liability, reports.balanceSheet.liabilities, reports.balanceSheet.totalLiabilities, 'Total liabilities')}
              {section(TYPE_NAMES.equity, reports.balanceSheet.equity, reports.balanceSheet.totalEquity, 'Total owner’s share')}
            </tbody></table>
          </div>
        </div>
      )}
      <h2 className="section">All accounts</h2>
      <table className="table">
        <thead><tr><th>Code</th><th>Account</th><th>Kind</th><th className="num">Balance today</th></tr></thead>
        <tbody>{accounts.map((a) => <tr key={a.code} className="click" onClick={() => openLedger(a.code)}><td className="mono">{a.code}</td><td>{a.name}</td><td className="muted">{TYPE_NAMES[a.type]}</td><td className="num">{money(a.balance, cur)}</td></tr>)}</tbody>
      </table>
      <p className="muted small" style={{ marginTop: 10 }}>Invoices, payments and expenses are entered in the books automatically. Use a journal entry for anything else, such as the opening bank balance, money the owner puts in, loans or a VAT payment.</p>

      {ledger && (
        <Modal title={`${ledger.account.code} ${ledger.account.name}`} wide onClose={() => setLedger(null)}>
          {ledger.rows.length === 0 ? <div className="empty">No entries yet.</div> : (
            <table className="table">
              <thead><tr><th>Date</th><th>What</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>{ledger.rows.map((r, i) => <tr key={r.id + i}><td className="muted">{day(r.date)}</td><td>{r.memo}</td><td className="num">{r.debit ? money(r.debit, cur) : ''}</td><td className="num">{r.credit ? money(r.credit, cur) : ''}</td><td className="num">{money(r.balance, cur)}</td></tr>)}</tbody>
            </table>
          )}
        </Modal>
      )}
      {journal && (
        <Modal title="New journal entry" wide onClose={() => setJournal(null)}>
          <div className="two">
            <Field label="Date"><input className="input" type="date" value={journal.date} onChange={(e) => setJournal({ ...journal, date: e.target.value })} /></Field>
            <Field label="What is it?"><input className="input" placeholder="e.g. Opening bank balance" value={journal.memo} onChange={(e) => setJournal({ ...journal, memo: e.target.value })} /></Field>
          </div>
          {journal.lines.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px 34px', gap: 8, marginBottom: 8 }}>
              <select className="input" aria-label="Account" value={l.account} onChange={(e) => setJournal({ ...journal, lines: journal.lines.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)) })}>
                {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
              </select>
              <input className="input" type="number" min="0" placeholder="Debit" aria-label="Debit" value={l.debit} onChange={(e) => setJournal({ ...journal, lines: journal.lines.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: e.target.value ? '' : x.credit } : x)) })} />
              <input className="input" type="number" min="0" placeholder="Credit" aria-label="Credit" value={l.credit} onChange={(e) => setJournal({ ...journal, lines: journal.lines.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: e.target.value ? '' : x.debit } : x)) })} />
              <button className="btn ghost icon" aria-label="Remove line" disabled={journal.lines.length <= 2} onClick={() => setJournal({ ...journal, lines: journal.lines.filter((_, j) => j !== i) })}><X size={14} /></button>
            </div>
          ))}
          <div className="spread">
            <button className="btn ghost" onClick={() => setJournal({ ...journal, lines: [...journal.lines, { account: '5090', debit: '', credit: '' }] })}><Plus size={14} /> Add line</button>
            <span className={`mono ${Math.abs(dr - cr) < 0.005 && dr > 0 ? '' : 'muted'}`}>Debits {dr.toFixed(2)} · Credits {cr.toFixed(2)}{Math.abs(dr - cr) >= 0.005 ? ` · off by ${Math.abs(dr - cr).toFixed(2)}` : ''}</span>
          </div>
          <p className="muted small">Money into the bank is a debit to Bank; the other side is where it came from (for an opening balance or the owner’s own money: a credit to Owner’s money).</p>
          <div className="modal-foot"><button className="btn primary" disabled={Math.abs(dr - cr) >= 0.005 || dr === 0} onClick={saveJournal}>Add entry</button></div>
        </Modal>
      )}
    </>
  );
}

// ---------- Bank ----------
type Suggestion = { kind: 'invoice' | 'expense'; id: string; label: string; amount: number };
type BankLine = { id: string; date: number; description: string; amount: number; match_kind: string | null; ignored: number; suggestions: Suggestion[] };
type Bank = { summary: { lines: number; open: number; statement: number; ledgerBank: number; difference: number }; lines: BankLine[] };
const MATCHED: Record<string, string> = { invoice: 'Customer payment', expense: 'Expense', journal: 'Journal entry' };

export function BankTab({ cur, attempt, notify, reload }: { cur: string; attempt: Attempt; notify: (t: string) => void; reload: () => void }) {
  const [bank, setBank] = useState<Bank | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [book, setBook] = useState<{ line: BankLine; as: 'expense' | 'journal'; vendor: string; category: string; vat: string; account: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const load = useCallback(() => rpc<Bank>('books.bank').then(setBank).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: string, args: object, done?: string) => { if (await attempt(() => rpc(fn, args), done)) { load(); reload(); } };
  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    const csv = await file.text();
    await attempt(async () => {
      const r = await rpc<{ added: number; skipped: number }>('books.importBank', { csv });
      await load();
      notify(`Imported ${r.added} line${r.added === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} already here` : ''}.`);
    });
    if (picker.current) picker.current.value = '';
  };
  const saveBook = async () => {
    const b = book!;
    if (await attempt(() => rpc('books.bookLine', { lineId: b.line.id, as: b.as, vendor: b.vendor, category: b.category, vat: Number(b.vat) || 0, account: b.account }), 'Booked.')) { setBook(null); load(); reload(); }
  };
  const lines = (bank?.lines ?? []).filter((l) => filter === 'all' || (!l.match_kind && !l.ignored));
  const s = bank?.summary;

  return (
    <>
      <div className="spread" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ margin: 0, maxWidth: '62ch' }}>Download a statement from your bank as a CSV file and import it. Each line is matched to an invoice payment or an expense, so the books agree with the bank.</p>
        <input ref={picker} type="file" accept=".csv,text/csv" hidden onChange={(e) => importCsv(e.target.files?.[0])} />
        <button className="btn primary" onClick={() => picker.current?.click()}><Upload size={15} /> Import statement (.csv)</button>
      </div>
      {s && s.lines > 0 && (
        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="card"><div className="stat-label">Lines to check</div><div className="stat-value">{s.open}</div></div>
          <div className="card"><div className="stat-label">Imported from the bank</div><div className="stat-value">{money(s.statement, cur)}</div></div>
          <div className="card"><div className="stat-label">Bank in the books</div><div className="stat-value">{money(s.ledgerBank, cur)}</div></div>
          <div className="card"><div className="stat-label">Difference</div><div className="stat-value" style={{ color: Math.abs(s.difference) < 0.01 ? 'var(--accent)' : 'var(--warn)' }}>{money(s.difference, cur)}</div></div>
        </div>
      )}
      {s && s.lines > 0 && Math.abs(s.difference) >= 0.01 && <p className="muted small" style={{ marginTop: -6 }}>A difference usually means lines still to check, expenses entered but not yet in a statement, or a missing opening balance (add one under Books, Journal entry).</p>}
      {s && s.lines > 0 && (
        <div className="tabs" style={{ display: 'inline-flex', marginBottom: 10 }}>
          <button className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>To check ({s.open})</button>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All lines ({s.lines})</button>
        </div>
      )}
      {bank && bank.lines.length === 0 && <div className="empty">No bank lines yet. Import a CSV statement to start.</div>}
      {bank && bank.lines.length > 0 && lines.length === 0 && <div className="empty">Every line is checked.</div>}
      {lines.length > 0 && (
        <table className="table">
          <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className={`bank-line ${l.match_kind || l.ignored ? 'done' : ''}`}>
                <td className="muted">{day(l.date)}</td>
                <td>{l.description}</td>
                <td className="num" style={{ color: l.amount > 0 ? 'var(--accent)' : undefined }}>{money(l.amount, cur)}</td>
                <td className="acts">
                  {l.match_kind ? <><span className="badge good"><Check size={11} /> {MATCHED[l.match_kind]}</span> <button className="btn ghost" onClick={() => act('books.unmatch', { lineId: l.id })}>Undo</button></>
                    : l.ignored ? <><span className="badge">ignored</span> <button className="btn ghost" onClick={() => act('books.ignore', { lineId: l.id, ignored: false })}>Undo</button></>
                      : (
                        <div className="sugg">
                          {l.suggestions.map((g) => <button key={g.id} className="btn" title="Match to this" onClick={() => act('books.match', { lineId: l.id, kind: g.kind, id: g.id }, 'Matched.')}><Check size={14} /> {g.label}</button>)}
                          {l.amount < 0 && <button className="btn ghost" onClick={() => setBook({ line: l, as: 'expense', vendor: l.description, category: 'Other', vat: '', account: '5090' })}>New expense</button>}
                          <button className="btn ghost" onClick={() => setBook({ line: l, as: 'journal', vendor: '', category: '', vat: '', account: l.amount > 0 ? '3000' : '5070' })}>Other…</button>
                          <button className="btn ghost" title="Leave this line out of the books" onClick={() => act('books.ignore', { lineId: l.id, ignored: true })}>Ignore</button>
                        </div>
                      )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {book && (
        <Modal title={book.as === 'expense' ? 'Book as a new expense' : 'Book this bank line'} onClose={() => setBook(null)}>
          <p style={{ marginTop: 0 }}><strong>{money(book.line.amount, cur)}</strong> <span className="muted">· {day(book.line.date)} · {book.line.description}</span></p>
          {book.as === 'expense' ? (
            <>
              <Field label="Paid to"><input className="input" value={book.vendor} onChange={(e) => setBook({ ...book, vendor: e.target.value })} /></Field>
              <div className="two">
                <Field label="Category"><select className="input" value={book.category} onChange={(e) => setBook({ ...book, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
                <Field label="VAT included in the amount"><input className="input" type="number" min="0" value={book.vat} onChange={(e) => setBook({ ...book, vat: e.target.value })} /></Field>
              </div>
            </>
          ) : (
            <Field label={book.line.amount > 0 ? 'Where did the money come from?' : 'What was the money for?'}>
              <select className="input" value={book.account} onChange={(e) => setBook({ ...book, account: e.target.value })}>
                {(book.line.amount > 0
                  ? [['3000', 'Owner’s money (you put money in)'], ['2200', 'A loan'], ['4900', 'Other income'], ['1100', 'A customer (no invoice here)'], ['2100', 'VAT refund from the tax office']]
                  : [['5070', 'Bank fees'], ['2100', 'VAT payment to the tax office'], ['3000', 'Owner took money out'], ['2200', 'Loan repayment'], ['1500', 'Equipment bought'], ['2000', 'A supplier bill']]
                ).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
              </select>
            </Field>
          )}
          <div className="modal-foot"><button className="btn primary" onClick={saveBook}>Book it</button></div>
        </Modal>
      )}
    </>
  );
}
