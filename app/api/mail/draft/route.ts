import { authed } from '@/lib/http';
import { draftEmail } from '@/lib/mail/assist';
import { getMail, getThread } from '@/lib/mail/store';

/** Ask the local AI model to write an email, or a reply when replyToId is given. */
export const POST = authed(async ({ req, user }) => {
  const { instruction = '', replyToId } = (await req.json()) as { instruction?: string; replyToId?: string };
  const parent = replyToId ? getMail(user.id, replyToId) : undefined;
  if (!parent && !instruction.trim()) throw new Error('Tell the assistant what the email should say.');
  return draftEmail(user, { instruction: instruction.trim(), thread: parent ? getThread(user.id, parent.thread_id) : undefined });
});
