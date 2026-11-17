import crypto from 'node:crypto';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { type Handlers, need } from '../rpc.ts';

export const STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'];
type Contact = { id: string; name: string; email: string; company: string; phone: string; notes: string };

export const crm: Handlers = {
  'crm.contacts': () => all<Contact>('SELECT * FROM crm_contacts ORDER BY name'),

  'crm.saveContact': (_u, c: Partial<Contact>) => {
    need(c.name?.trim(), 'A contact needs a name.');
    const v = [c.name!.trim(), (c.email ?? '').trim().toLowerCase(), c.company ?? '', c.phone ?? '', c.notes ?? ''];
    if (c.id) {
      run('UPDATE crm_contacts SET name = ?, email = ?, company = ?, phone = ?, notes = ? WHERE id = ?', ...v, c.id);
      return { id: c.id };
    }
    const id = crypto.randomUUID();
    run('INSERT INTO crm_contacts (name, email, company, phone, notes, id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ...v, id, Date.now());
    return { id };
  },

  'crm.removeContact': (_u, { id }: { id: string }) => {
    run('UPDATE crm_deals SET contact_id = NULL WHERE contact_id = ?', id);
    run('DELETE FROM crm_contacts WHERE id = ?', id);
  },

  /** One contact with everything the company knows: deals, invoices, and the user's emails with them. */
  'crm.contact': (u, { id }: { id: string }) => {
    const contact = get<Contact>('SELECT * FROM crm_contacts WHERE id = ?', id);
    need(contact, 'That contact does not exist.');
    return {
      contact,
      deals: all('SELECT * FROM crm_deals WHERE contact_id = ? ORDER BY updated_at DESC', id),
      invoices: all("SELECT id, number, status, items, vat_rate, issued_at FROM acc_invoices WHERE contact_id = ? AND kind = 'invoice' ORDER BY issued_at DESC", id),
      emails: contact.email
        ? all(
            `SELECT id, subject, snippet, folder, created_at FROM mail_messages
             WHERE owner_id = ? AND folder != 'trash' AND (from_addr = ? OR to_addrs LIKE ?) ORDER BY created_at DESC LIMIT 10`,
            u.id, contact.email, `%"${contact.email}"%`,
          )
        : [],
    };
  },

  'crm.deals': () =>
    all('SELECT d.*, c.name AS contact_name FROM crm_deals d LEFT JOIN crm_contacts c ON c.id = d.contact_id ORDER BY d.updated_at DESC'),

  'crm.saveDeal': (u, d: { id?: string; title?: string; value?: number; stage?: string; contact_id?: string | null }) => {
    if (d.id) {
      const old = get<{ title: string; value: number; stage: string; contact_id: string | null }>('SELECT * FROM crm_deals WHERE id = ?', d.id);
      need(old, 'That deal does not exist.');
      const stage = d.stage ?? old.stage;
      need(STAGES.includes(stage), 'Unknown stage.');
      run('UPDATE crm_deals SET title = ?, value = ?, stage = ?, contact_id = ?, updated_at = ? WHERE id = ?',
        d.title?.trim() || old.title, Number(d.value ?? old.value) || 0, stage, d.contact_id === undefined ? old.contact_id : d.contact_id, Date.now(), d.id);
      if (stage === 'won' && old.stage !== 'won')
        emit({ type: 'crm.deal.won', app: 'crm', userId: u.id, summary: `Deal won: ${old.title}`, payload: { dealId: d.id } });
      return { id: d.id };
    }
    need(d.title?.trim(), 'Give the deal a name.');
    const id = crypto.randomUUID();
    run('INSERT INTO crm_deals (id, contact_id, title, value, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, d.contact_id || null, d.title!.trim(), Number(d.value) || 0, 'lead', Date.now(), Date.now());
    return { id };
  },

  'crm.removeDeal': (_u, { id }: { id: string }) => {
    run('DELETE FROM crm_deals WHERE id = ?', id);
  },
};
