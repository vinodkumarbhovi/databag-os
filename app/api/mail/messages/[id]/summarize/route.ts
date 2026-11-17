import { authed } from '@/lib/http';
import { summarizeThread } from '@/lib/mail/assist';
import { getMail, getThread, saveSummary } from '@/lib/mail/store';

export const POST = authed<{ id: string }>(async ({ user, params }) => {
  const mail = getMail(user.id, params.id);
  if (!mail) return Response.json({ error: 'Message not found.' }, { status: 404 });
  const summary = await summarizeThread(user, getThread(user.id, mail.thread_id));
  saveSummary(user.id, mail.id, summary);
  return { summary };
});
