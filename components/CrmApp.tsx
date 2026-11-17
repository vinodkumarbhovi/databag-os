'use client';

import { Mail, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { money, rpc, when } from '@/lib/client';
import { Field, Modal, useToast } from './ui';

type Contact = { id: string; name: string; email: string; company: string; phone: string; notes: string };
type Deal = { id: string; title: string; value: number; stage: string; contact_id: string | null; contact_name: string | null };
type Detail = { contact: Contact; deals: Deal[]; invoices: { id: string; number: string; status: string }[]; emails: { id: string; subject: string; folder: string; created_at: number }[] };
const STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'];
const BLANK: Partial<Contact> = { name: '', email: '', company: '', phone: '', notes: '' };

export function CrmApp() {
  const [tab, setTab] = useState<'contacts' | 'pipeline'>('contacts');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [contactForm, setContactForm] = useState<Partial<Contact> | null>(null);
  const [dealForm, setDealForm] = useState<{ title: string; value: string; contact_id: string } | null>(null);
  const { toast, attempt } = useToast();

  const load = useCallback(() => {
    rpc<Contact[]>('crm.contacts').then(setContacts).catch(() => {});
    rpc<Deal[]>('crm.deals').then(setDeals).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const show = (id: string) => attempt(async () => setDetail(await rpc<Detail>('crm.contact', { id })));
  const saveContact = async () => {
    if (await attempt(() => rpc('crm.saveContact', contactForm), 'Saved.')) { setContactForm(null); load(); if (detail && contactForm?.id) show(contactForm.id); }
  };
  const removeContact = async (c: Contact) => {
    if (window.confirm(`Delete ${c.name}? Their deals are kept.`) && (await attempt(() => rpc('crm.removeContact', { id: c.id }), 'Deleted.'))) { setDetail(null); load(); }
  };
  const saveDeal = async () => {
    if (await attempt(() => rpc('crm.saveDeal', { ...dealForm, value: Number(dealForm!.value) || 0 }), 'Deal added.')) { setDealForm(null); load(); }
  };
  const moveDeal = async (d: Deal, stage: string) => { if (await attempt(() => rpc('crm.saveDeal', { id: d.id, stage }))) load(); };
  const removeDeal = async (d: Deal) => { if (window.confirm(`Delete the deal "${d.title}"?`) && (await attempt(() => rpc('crm.removeDeal', { id: d.id })))) load(); };
  const setC = (k: keyof Contact) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setContactForm({ ...contactForm, [k]: e.target.value });

  return (
    <div className="app">
      <div className="bar">
        <span className="grow-gap" />
        <div className="tabs">
          <button className={tab === 'contacts' ? 'on' : ''} onClick={() => setTab('contacts')}>Contacts</button>
          <button className={tab === 'pipeline' ? 'on' : ''} onClick={() => setTab('pipeline')}>Pipeline</button>
        </div>
        {tab === 'contacts'
          ? <button className="btn primary" onClick={() => setContactForm(BLANK)}><Plus size={15} /> New contact</button>
          : <button className="btn primary" onClick={() => setDealForm({ title: '', value: '', contact_id: '' })}><Plus size={15} /> New deal</button>}
      </div>
      <div className="body">
        {tab === 'contacts' && (
          <div className={detail ? 'split-view' : ''}>
            <div>
              {!contacts.length && <div className="empty">No contacts yet.</div>}
              {contacts.length > 0 && (
                <table className="table">
                  <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th></tr></thead>
                  <tbody>
                    {contacts.map((c) => (
                      <tr key={c.id} className="click" onClick={() => show(c.id)}>
                        <td><strong>{c.name}</strong></td><td>{c.company}</td><td className="muted">{c.email}</td><td className="muted">{c.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {detail && (
              <aside className="card">
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ flex: 1, fontSize: 16 }}>{detail.contact.name}</strong>
                  <button className="btn ghost icon" aria-label="Delete contact" onClick={() => removeContact(detail.contact)}><Trash2 size={15} /></button>
                </div>
                <div className="muted">{[detail.contact.company, detail.contact.email, detail.contact.phone].filter(Boolean).join(' · ')}</div>
                {detail.contact.notes && <p style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}>{detail.contact.notes}</p>}
                <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
                  {detail.contact.email && <a className="btn" href={`/mail?to=${encodeURIComponent(detail.contact.email)}`}><Mail size={15} /> Email</a>}
                  <button className="btn" onClick={() => setContactForm(detail.contact)}>Edit</button>
                  <button className="btn" onClick={() => setDealForm({ title: '', value: '', contact_id: detail.contact.id })}>Add deal</button>
                </div>
                <div className="label">Deals</div>
                {detail.deals.map((d) => <div key={d.id} className="row" style={{ padding: '6px 0' }}><span className="grow">{d.title}</span><span className="badge">{d.stage}</span><span>{money(d.value)}</span></div>)}
                {!detail.deals.length && <div className="muted">None yet.</div>}
                <div className="label" style={{ marginTop: 12 }}>Invoices</div>
                {detail.invoices.map((i) => <div key={i.id} className="row" style={{ padding: '6px 0' }}><span className="grow">{i.number}</span><span className="badge">{i.status}</span></div>)}
                {!detail.invoices.length && <div className="muted">None yet.</div>}
                <div className="label" style={{ marginTop: 12 }}>Your recent emails</div>
                {detail.emails.map((m) => <a key={m.id} className="row" style={{ padding: '6px 0' }} href="/mail"><span className="grow">{m.subject || '(no subject)'}</span><span className="muted mono">{when(m.created_at)}</span></a>)}
                {!detail.emails.length && <div className="muted">None yet.</div>}
              </aside>
            )}
          </div>
        )}
        {tab === 'pipeline' && (
          <div style={{ overflowX: 'auto' }}>
            <div className="kanban">
              {STAGES.map((stage) => {
                const list = deals.filter((d) => d.stage === stage);
                return (
                  <div key={stage}>
                    <h3><span>{stage}</span><span>{money(list.reduce((s, d) => s + d.value, 0))}</span></h3>
                    {list.map((d) => (
                      <div key={d.id} className="card deal">
                        <div style={{ display: 'flex', gap: 6 }}>
                          <strong style={{ flex: 1 }}>{d.title}</strong>
                          <button className="btn ghost icon" style={{ height: 22, width: 22 }} aria-label={`Delete ${d.title}`} onClick={() => removeDeal(d)}><Trash2 size={13} /></button>
                        </div>
                        <div className="muted">{d.contact_name ?? 'No contact'} · {money(d.value)}</div>
                        <select className="input" aria-label={`Stage of ${d.title}`} value={d.stage} onChange={(e) => moveDeal(d, e.target.value)}>
                          {STAGES.map((s) => <option key={s} value={s}>Move to: {s}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {contactForm && (
        <Modal title={contactForm.id ? 'Edit contact' : 'New contact'} onClose={() => setContactForm(null)}>
          <Field label="Name"><input className="input" autoFocus value={contactForm.name ?? ''} onChange={setC('name')} /></Field>
          <div className="two">
            <Field label="Company"><input className="input" value={contactForm.company ?? ''} onChange={setC('company')} /></Field>
            <Field label="Phone"><input className="input" value={contactForm.phone ?? ''} onChange={setC('phone')} /></Field>
          </div>
          <Field label="Email"><input className="input" type="email" value={contactForm.email ?? ''} onChange={setC('email')} /></Field>
          <Field label="Notes"><textarea className="input" value={contactForm.notes ?? ''} onChange={setC('notes')} /></Field>
          <div className="modal-foot"><button className="btn primary" onClick={saveContact}>Save</button></div>
        </Modal>
      )}
      {dealForm && (
        <Modal title="New deal" onClose={() => setDealForm(null)}>
          <Field label="Deal name"><input className="input" autoFocus value={dealForm.title} onChange={(e) => setDealForm({ ...dealForm, title: e.target.value })} /></Field>
          <div className="two">
            <Field label="Value"><input className="input" type="number" min="0" value={dealForm.value} onChange={(e) => setDealForm({ ...dealForm, value: e.target.value })} /></Field>
            <Field label="Contact">
              <select className="input" value={dealForm.contact_id} onChange={(e) => setDealForm({ ...dealForm, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="modal-foot"><button className="btn primary" onClick={saveDeal}>Add deal</button></div>
        </Modal>
      )}
      {toast}
    </div>
  );
}
