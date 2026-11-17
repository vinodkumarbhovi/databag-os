import { authed } from '@/lib/http';
import { type Folder, deleteMail, getMail, getThread, updateMail } from '@/lib/mail/store';

type P = { id: string };
const missing = () => Response.json({ error: 'Message not found.' }, { status: 404 });

/** Open a message: returns its whole conversation and marks it read. */
export const GET = authed<P>(({ user, params }) => {
  const mail = getMail(user.id, params.id);
  if (!mail) return missing();
  if (!mail.is_read) updateMail(user.id, mail.id, { is_read: true });
  const thread = mail.folder === 'trash' ? [mail] : getThread(user.id, mail.thread_id);
  return { mail: { ...mail, is_read: true }, thread };
});

export const PATCH = authed<P>(async ({ req, user, params }) => {
  if (!getMail(user.id, params.id)) return missing();
  const patch = (await req.json()) as { is_read?: boolean; is_starred?: boolean; folder?: Folder };
  updateMail(user.id, params.id, patch);
});

export const DELETE = authed<P>(({ user, params }) => {
  if (!getMail(user.id, params.id)) return missing();
  return { result: deleteMail(user.id, params.id) };
});
