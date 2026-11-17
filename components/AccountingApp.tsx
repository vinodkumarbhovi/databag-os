'use client';

import { BellRing, FileCheck, Plus, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { money, rpc } from '@/lib/client';
import { BankTab, BooksTab, RecurringTab } from './AccountingBooks';
import { Field, Modal, useToast } from './ui';

type Item = { desc: string; qty: string; price: string };
type Invoice = { id: string; number: string; customer_name: string; customer_email: string; status: string; issued_at: number; due_at: number; subtotal: number; vat: number; total: number; overdue?: boolean; reminded_at?: number | null };
type Expense = { id: string; vendor: string; description: string; category: string; amount: number; vat: number; spent_at: number };
type Summary = { currency: string; revenue: number; expenses: number; profit: number; vatCollected: number; vatPaid: number; vatDue: number; outstanding: number; overdue: number };
type Contact = { id: string; name: string; email: string };
const CATEGORIES = ['Software', 'Office', 'Travel', 'Marketing', 'Salaries', 'Professional fees', 'Equipment', 'Bank fees', 'Other'];
const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function AccountingApp() {
  const [tab, setTab] = useState<'overview' | 'invoices' | 'quotes' | 'expenses' | 'recurring' | 'books' | 'bank'>('overview');
  const [autoRemind, setAutoRemind] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [inv, setInv] = useState<{ kind: 'invoice' | 'quote'; contact_id: string; customer_name: string; customer_email: string; vat_rate: string; items: Item[] } | null>(null);
  const [exp, setExp] = useState<{ vendor: string; description: string; category: string; amount: string; vat: string; date: string } | null>(null);
  const { toast, notify, attempt } = useToast();
  const cur = summary?.currency ?? 'EUR';

  const load = useCallback(() => {
    rpc<Summary>('acc.summary').then(setSummary).catch(() => {});
    rpc<Invoice[]>('acc.invoices').then(setInvoices).catch(() => {});
    rpc<Invoice[]>('acc.quotes').then(setQuotes).catch(() => {});
    rpc<Expense[]>('acc.expenses').then(setExpenses).catch(() => {});
    rpc<Contact[]>('crm.contacts').then(setContacts).catch(() => {});
    rpc<{ autoRemind: boolean }>('acc.settings').then((s) => setAutoRemind(s.autoRemind)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: string, args: unknown, done: string) => { if (await attempt(() => rpc(fn, args), done)) load(); };
  const createInvoice = async () => {
    if (await attempt(() => rpc('acc.createInvoice', { ...inv, vat_rate: Number(inv!.vat_rate) || 0 }), inv!.kind === 'quote' ? 'Quote created.' : 'Invoice created.')) { setTab(inv!.kind === 'quote' ? 'quotes' : 'invoices'); setInv(null); load(); }
  };
  const addExpense = async () => {
    if (await attempt(() => rpc('acc.addExpense', { ...exp, amount: Number(exp!.amount), vat: Number(exp!.vat) || 0, spent_at: new Date(exp!.date).getTime() }), 'Expense added.')) { setExp(null); setTab('expenses'); load(); }
  };
  const pickContact = (id: string) => {
    const c = contacts.find((x) => x.id === id);
    setInv({ ...inv!, contact_id: id, customer_name: c?.name ?? inv!.customer_name, customer_email: c?.email ?? inv!.customer_email });
  };
  const setItem = (i: number, k: keyof Item, v: string) => setInv({ ...inv!, items: inv!.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const draftTotal = inv ? inv.items.reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.price) || 0), 0) : 0;

  return (
    <div className="app">
      <div className="bar">
        <span className="grow-gap" />
        <div className="tabs">
          {(['overview', 'invoices', 'quotes', 'expenses', 'recurring', 'books', 'bank'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} style={{ textTransform: 'capitalize' }}>{t}</button>)}
        </div>
        <button className="btn" onClick={() => setExp({ vendor: '', description: '', category: 'Other', amount: '', vat: '', date: new Date().toISOString().slice(0, 10) })}><Plus size={15} /> Expense</button>
        <button className="btn" onClick={() => setInv({ kind: 'quote', contact_id: '', customer_name: '', customer_email: '', vat_rate: '21', items: [{ desc: '', qty: '1', price: '' }] })}><Plus size={15} /> Quote</button>
        <button className="btn primary" onClick={() => setInv({ kind: 'invoice', contact_id: '', customer_name: '', customer_email: '', vat_rate: '21', items: [{ desc: '', qty: '1', price: '' }] })}><Plus size={15} /> Invoice</button>
      </div>
      <div className="body">
        {tab === 'overview' && summary && (
          <>
            <div className="stats">
              {([['Revenue (excl. VAT)', summary.revenue], ['Expenses (excl. VAT)', summary.expenses], ['Profit', summary.profit], ['Waiting to be paid', summary.outstanding], ['Of which overdue', summary.overdue]] as const).map(([label, v]) => (
                <div key={label} className="card"><div className="stat-label">{label}</div><div className="stat-value">{money(v, cur)}</div></div>
              ))}
            </div>
            <h2 style={{ fontSize: 13, margin: '24px 0 10px' }}>VAT position</h2>
            <table className="table" style={{ maxWidth: 460 }}>
              <tbody>
                <tr><td>VAT charged on invoices</td><td className="num">{money(summary.vatCollected, cur)}</td></tr>
                <tr><td>VAT paid on expenses</td><td className="num">{money(summary.vatPaid, cur)}</td></tr>
                <tr><td><strong>{summary.vatDue >= 0 ? 'VAT to pay' : 'VAT to reclaim'}</strong></td><td className="num"><strong>{money(Math.abs(summary.vatDue), cur)}</strong></td></tr>
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Draft invoices are not counted. These figures are a working summary, not a tax filing.</p>
            {autoRemind !== null && (
              <label className="panel pad spread" style={{ marginTop: 20, maxWidth: 620, cursor: 'pointer' }}>
                <span><strong>Chase late payments automatically</strong><div className="muted small">Emails a polite reminder three days after an invoice is due, then once a week, up to four times.</div></span>
                <input type="checkbox" checked={autoRemind} onChange={async (e) => { const on = e.target.checked; if (await attempt(() => rpc('acc.saveSettings', { autoRemind: on }), on ? 'Automatic reminders are on.' : 'Automatic reminders are off.')) setAutoRemind(on); }} />
              </label>
            )}
          </>
        )}
        {tab === 'invoices' && (invoices.length ? (
          <table className="table">
            <thead><tr><th>Number</th><th>Customer</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.number}</td><td>{i.customer_name}</td><td className="muted">{day(i.issued_at)}</td><td className="muted">{day(i.due_at)}</td>
                  <td><span className={`badge ${i.status === 'paid' ? 'good' : i.status === 'sent' ? 'info' : ''}`}>{i.overdue ? 'overdue' : i.status}</span>{i.reminded_at ? <small className="muted"> reminded {day(i.reminded_at)}</small> : null}</td>
                  <td className="num">{money(i.total, cur)}</td>
                  <td className="acts">
                    {i.status === 'sent' && i.customer_email && <button className="btn ghost" onClick={() => act('acc.remind', { id: i.id }, `Reminder for ${i.number} emailed.`)}><BellRing size={14} /> Send reminder</button>}
                    {i.status === 'draft' && <button className="btn" onClick={() => act('acc.sendInvoice', { id: i.id }, `Invoice ${i.number} emailed.`)}><Send size={14} /> Email it</button>}
                    {i.status === 'draft' && <button className="btn ghost" onClick={() => act('acc.setStatus', { id: i.id, status: 'sent' }, 'Marked as sent.')}>Mark sent</button>}
                    {i.status === 'sent' && <button className="btn" onClick={() => act('acc.setStatus', { id: i.id, status: 'paid' }, 'Marked as paid.')}>Mark paid</button>}
                    {i.status === 'draft' && <button className="btn ghost icon" aria-label={`Delete ${i.number}`} onClick={() => act('acc.removeInvoice', { id: i.id }, 'Deleted.')}><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No invoices yet.</div>)}
        {tab === 'quotes' && (quotes.length ? (
          <table className="table">
            <thead><tr><th>Number</th><th>Customer</th><th>Issued</th><th>Valid until</th><th>Status</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {quotes.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.number}</td><td>{i.customer_name}</td><td className="muted">{day(i.issued_at)}</td><td className="muted">{day(i.due_at)}</td>
                  <td><span className={`badge ${i.status === 'accepted' ? 'good' : i.status === 'sent' ? 'info' : ''}`}>{i.status}</span></td>
                  <td className="num">{money(i.total, cur)}</td>
                  <td className="acts">
                    {i.status === 'draft' && <button className="btn" onClick={() => act('acc.sendInvoice', { id: i.id }, `Quote ${i.number} emailed.`)}><Send size={14} /> Email it</button>}
                    {i.status !== 'accepted' && i.status !== 'declined' && <button className="btn" onClick={() => act('acc.convertQuote', { id: i.id }, 'Accepted. A draft invoice was created.')}><FileCheck size={14} /> Accepted: make invoice</button>}
                    {i.status === 'sent' && <button className="btn ghost" onClick={() => act('acc.setStatus', { id: i.id, status: 'declined' }, 'Marked as declined.')}>Declined</button>}
                    {i.status === 'draft' && <button className="btn ghost icon" aria-label={`Delete ${i.number}`} onClick={() => act('acc.removeInvoice', { id: i.id }, 'Deleted.')}><Trash2 size={15} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No quotes yet.</div>)}
        {tab === 'recurring' && <RecurringTab cur={cur} contacts={contacts} attempt={attempt} reload={load} />}
        {tab === 'books' && <BooksTab cur={cur} attempt={attempt} />}
        {tab === 'bank' && <BankTab cur={cur} attempt={attempt} notify={notify} reload={load} />}
        {tab === 'expenses' && (expenses.length ? (
          <table className="table">
            <thead><tr><th>Date</th><th>Paid to</th><th>For</th><th>Category</th><th className="num">Amount</th><th className="num">VAT</th><th /></tr></thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{day(e.spent_at)}</td><td>{e.vendor}</td><td className="muted">{e.description}</td><td><span className="badge">{e.category}</span></td>
                  <td className="num">{money(e.amount, cur)}</td><td className="num">{money(e.vat, cur)}</td>
                  <td className="acts"><button className="btn ghost icon" aria-label="Delete expense" onClick={() => act('acc.removeExpense', { id: e.id }, 'Deleted.')}><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No expenses yet.</div>)}
      </div>

      {inv && (
        <Modal title={inv.kind === 'quote' ? 'New quote' : 'New invoice'} wide onClose={() => setInv(null)}>
          {contacts.length > 0 && (
            <Field label="Customer from CRM">
              <select className="input" value={inv.contact_id} onChange={(e) => pickContact(e.target.value)}>
                <option value="">Someone else…</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <div className="two">
            <Field label="Customer name"><input className="input" value={inv.customer_name} onChange={(e) => setInv({ ...inv, customer_name: e.target.value })} /></Field>
            <Field label="Customer email"><input className="input" type="email" value={inv.customer_email} onChange={(e) => setInv({ ...inv, customer_email: e.target.value })} /></Field>
          </div>
          <span className="label">Lines</span>
          {inv.items.map((x, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 110px', gap: 8, marginBottom: 8 }}>
              <input className="input" placeholder="Description" aria-label="Description" value={x.desc} onChange={(e) => setItem(i, 'desc', e.target.value)} />
              <input className="input" type="number" min="0" placeholder="Qty" aria-label="Quantity" value={x.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} />
              <input className="input" type="number" min="0" placeholder="Unit price" aria-label="Unit price" value={x.price} onChange={(e) => setItem(i, 'price', e.target.value)} />
            </div>
          ))}
          <button className="btn ghost" onClick={() => setInv({ ...inv, items: [...inv.items, { desc: '', qty: '1', price: '' }] })}><Plus size={14} /> Add line</button>
          <div className="two" style={{ marginTop: 12, alignItems: 'end' }}>
            <Field label="VAT rate (%)"><input className="input" type="number" min="0" value={inv.vat_rate} onChange={(e) => setInv({ ...inv, vat_rate: e.target.value })} /></Field>
            <div className="field" style={{ textAlign: 'right' }}>
              <div className="muted">Subtotal {money(draftTotal, cur)}</div>
              <strong>Total {money(draftTotal * (1 + (Number(inv.vat_rate) || 0) / 100), cur)}</strong>
            </div>
          </div>
          <div className="modal-foot"><button className="btn primary" onClick={createInvoice}>{inv.kind === 'quote' ? 'Create quote' : 'Create invoice'}</button></div>
        </Modal>
      )}
      {exp && (
        <Modal title="New expense" onClose={() => setExp(null)}>
          <div className="two">
            <Field label="Paid to"><input className="input" autoFocus value={exp.vendor} onChange={(e) => setExp({ ...exp, vendor: e.target.value })} /></Field>
            <Field label="Date"><input className="input" type="date" value={exp.date} onChange={(e) => setExp({ ...exp, date: e.target.value })} /></Field>
          </div>
          <Field label="What was it for?"><input className="input" value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} /></Field>
          <Field label="Category">
            <select className="input" value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <div className="two">
            <Field label="Amount (excl. VAT)"><input className="input" type="number" min="0" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} /></Field>
            <Field label="VAT paid"><input className="input" type="number" min="0" value={exp.vat} onChange={(e) => setExp({ ...exp, vat: e.target.value })} /></Field>
          </div>
          <div className="modal-foot"><button className="btn primary" onClick={addExpense}>Add expense</button></div>
        </Modal>
      )}
      {toast}
    </div>
  );
}
