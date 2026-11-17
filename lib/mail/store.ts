import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { type User, findUserByEmail } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';

export type Folder = 'inbox' | 'sent' | 'archive' | 'trash';
export const FOLDERS: Folder[] = ['inbox', 'sent', 'archive', 'trash'];

export type MailRow = {
  id: string;
  owner_id: string;
  folder: Folder;
  thread_id: string;
  message_id: string;
  in_reply_to: string | null;
  from_addr: string;
  from_name: string;
  to_addrs: string;
  cc_addrs: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  snippet: string;
  is_read: number;
  is_starred: number;
  delivery: string | null;
  ai_summary: string | null;
  created_at: number;
};

export type Mail = Omit<MailRow, 'to_addrs' | 'cc_addrs' | 'is_read' | 'is_starred' | 'delivery'> & {
  to: string[];
  cc: string[];
  is_read: boolean;
  is_starred: boolean;
  delivery: DeliveryResult[] | null;
};

export type DeliveryResult = { to: string; status: 'delivered' | 'relayed' | 'failed'; detail?: string };

const toMail = (r: MailRow): Mail => {
  const { to_addrs, cc_addrs, is_read, is_starred, delivery, ...rest } = r;
  return {
    ...rest,
    to: JSON.parse(to_addrs),
    cc: JSON.parse(cc_addrs),
    is_read: !!is_read,
    is_starred: !!is_starred,
    delivery: delivery ? JSON.parse(delivery) : null,
  };
};

const LIST_COLS =
  "id, owner_id, folder, thread_id, message_id, in_reply_to, from_addr, from_name, to_addrs, cc_addrs, subject, '' AS body_text, NULL AS body_html, snippet, is_read, is_starred, delivery, NULL AS ai_summary, created_at";

/** List one folder, or the virtual "starred" view, optionally filtered by a search term. */
export function listMail(ownerId: string, folder: Folder | 'starred', query?: string): Mail[] {
  const where = folder === 'starred' ? "is_starred = 1 AND folder != 'trash'" : 'folder = ?';
  const params: string[] = folder === 'starred' ? [ownerId] : [ownerId, folder];
  let search = '';
  if (query?.trim()) {
    search = ' AND (subject LIKE ? OR body_text LIKE ? OR from_addr LIKE ? OR from_name LIKE ? OR to_addrs LIKE ?)';
    const like = `%${query.trim().replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like, like);
  }
  return all<MailRow>(
    `SELECT ${LIST_COLS} FROM mail_messages WHERE owner_id = ? AND ${where}${search} ORDER BY created_at DESC LIMIT 200`,
    ...params,
  ).map(toMail);
}

export function unreadCounts(ownerId: string): Record<string, number> {
  const rows = all<{ folder: string; n: number }>(
    'SELECT folder, COUNT(*) AS n FROM mail_messages WHERE owner_id = ? AND is_read = 0 GROUP BY folder', ownerId,
  );
  return Object.fromEntries(rows.map((r) => [r.folder, r.n]));
}

export function getMail(ownerId: string, id: string): Mail | undefined {
  const row = get<MailRow>('SELECT * FROM mail_messages WHERE owner_id = ? AND id = ?', ownerId, id);
  return row && toMail(row);
}

/** Every message in a conversation that is not in the trash, oldest first. */
export function getThread(ownerId: string, threadId: string): Mail[] {
  return all<MailRow>(
    "SELECT * FROM mail_messages WHERE owner_id = ? AND thread_id = ? AND folder != 'trash' ORDER BY created_at ASC",
    ownerId, threadId,
  ).map(toMail);
}

export function updateMail(ownerId: string, id: string, patch: { is_read?: boolean; is_starred?: boolean; folder?: Folder }): void {
  if (patch.is_read !== undefined) run('UPDATE mail_messages SET is_read = ? WHERE owner_id = ? AND id = ?', patch.is_read ? 1 : 0, ownerId, id);
  if (patch.is_starred !== undefined) run('UPDATE mail_messages SET is_starred = ? WHERE owner_id = ? AND id = ?', patch.is_starred ? 1 : 0, ownerId, id);
  if (patch.folder !== undefined) {
    if (!FOLDERS.includes(patch.folder)) throw new Error('Unknown folder.');
    run('UPDATE mail_messages SET folder = ? WHERE owner_id = ? AND id = ?', patch.folder, ownerId, id);
  }
}

/** Move to trash, or delete for good when it is already there. */
export function deleteMail(ownerId: string, id: string): 'trashed' | 'deleted' {
  const mail = getMail(ownerId, id);
  if (!mail) throw new Error('Message not found.');
  if (mail.folder === 'trash') {
    run('DELETE FROM mail_messages WHERE owner_id = ? AND id = ?', ownerId, id);
    return 'deleted';
  }
  updateMail(ownerId, id, { folder: 'trash' });
  return 'trashed';
}

export function saveSummary(ownerId: string, id: string, summary: string): void {
  run('UPDATE mail_messages SET ai_summary = ? WHERE owner_id = ? AND id = ?', summary, ownerId, id);
}

const snippetOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 140);

type Envelope = {
  messageId: string;
  inReplyTo: string | null;
  from: { addr: string; name: string };
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string | null;
  date?: number;
};

function insertCopy(owner: User, folder: Folder, env: Envelope, extra: { read: boolean; threadId?: string; delivery?: DeliveryResult[] }): string {
  // Join the owner's existing conversation when this is a reply to a message they already hold.
  const parent = env.inReplyTo
    ? get<{ thread_id: string }>('SELECT thread_id FROM mail_messages WHERE owner_id = ? AND message_id = ?', owner.id, env.inReplyTo)
    : undefined;
  const id = crypto.randomUUID();
  run(
    `INSERT INTO mail_messages (id, owner_id, folder, thread_id, message_id, in_reply_to, from_addr, from_name, to_addrs, cc_addrs,
       subject, body_text, body_html, snippet, is_read, delivery, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, owner.id, folder, extra.threadId ?? parent?.thread_id ?? crypto.randomUUID(), env.messageId, env.inReplyTo,
    env.from.addr, env.from.name, JSON.stringify(env.to), JSON.stringify(env.cc),
    env.subject, env.text, env.html, snippetOf(env.text), extra.read ? 1 : 0,
    extra.delivery ? JSON.stringify(extra.delivery) : null, env.date ?? Date.now(),
  );
  return id;
}

/** Put a message into a company mailbox. Used for internal mail and for mail arriving over SMTP. */
export function deliverLocal(recipient: User, env: Envelope): string {
  const id = insertCopy(recipient, 'inbox', env, { read: false });
  emit({
    type: 'mail.received',
    app: 'mail',
    userId: recipient.id,
    summary: `New email from ${env.from.name || env.from.addr}: ${env.subject || '(no subject)'}`,
    payload: { mailId: id, from: env.from.addr, subject: env.subject },
  });
  return id;
}

const isAddress = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export type SendInput = { to: string[]; cc?: string[]; subject: string; body: string; inReplyToId?: string };

/** Send a message: colleagues get it instantly; outside addresses go through the relay if one is set. */
export async function sendMail(sender: User, input: SendInput): Promise<{ id: string; delivery: DeliveryResult[] }> {
  const clean = (list?: string[]) => [...new Set((list ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))];
  const to = clean(input.to);
  const cc = clean(input.cc);
  if (!to.length) throw new Error('Add at least one recipient.');
  const bad = [...to, ...cc].find((a) => !isAddress(a));
  if (bad) throw new Error(`"${bad}" is not a valid email address.`);
  if (!input.subject.trim() && !input.body.trim()) throw new Error('Write a subject or a message first.');

  const config = loadConfig();
  const parent = input.inReplyToId ? getMail(sender.id, input.inReplyToId) : undefined;
  const env: Envelope = {
    messageId: `<${crypto.randomUUID()}@${config.company.domain}>`,
    inReplyTo: parent?.message_id ?? null,
    from: { addr: sender.email, name: sender.name },
    to,
    cc,
    subject: input.subject.trim(),
    text: input.body,
    html: null,
  };

  const delivery: DeliveryResult[] = [];
  const external: string[] = [];
  for (const addr of [...to, ...cc]) {
    const local = findUserByEmail(addr);
    if (local) {
      deliverLocal(local, env);
      delivery.push({ to: addr, status: 'delivered' });
    } else {
      external.push(addr);
    }
  }

  if (external.length) {
    if (!config.relay) {
      for (const addr of external)
        delivery.push({ to: addr, status: 'failed', detail: 'No outbound mail relay is set up yet, so mail can only reach people in this company.' });
    } else {
      try {
        const transport = nodemailer.createTransport({
          host: config.relay.host,
          port: config.relay.port,
          secure: config.relay.secure ?? false,
          auth: config.relay.user ? { user: config.relay.user, pass: config.relay.pass ?? '' } : undefined,
        });
        await transport.sendMail({
          envelope: { from: sender.email, to: external },
          messageId: env.messageId,
          inReplyTo: env.inReplyTo ?? undefined,
          from: { name: sender.name, address: sender.email },
          to,
          cc,
          subject: env.subject,
          text: env.text,
        });
        for (const addr of external) delivery.push({ to: addr, status: 'relayed' });
      } catch (err) {
        for (const addr of external) delivery.push({ to: addr, status: 'failed', detail: (err as Error).message });
      }
    }
  }

  const id = insertCopy(sender, 'sent', env, { read: true, threadId: parent?.thread_id, delivery });
  emit({
    type: 'mail.sent',
    app: 'mail',
    userId: sender.id,
    summary: `You emailed ${to.join(', ')}: ${env.subject || '(no subject)'}`,
    payload: { mailId: id, to, subject: env.subject },
  });
  return { id, delivery };
}
