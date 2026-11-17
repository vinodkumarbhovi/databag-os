import { authed } from '@/lib/http';
import { FOLDERS, type Folder, listMail, unreadCounts } from '@/lib/mail/store';

export const GET = authed(({ req, user }) => {
  const url = new URL(req.url);
  const folder = url.searchParams.get('folder') ?? 'inbox';
  if (folder !== 'starred' && !FOLDERS.includes(folder as Folder)) throw new Error('Unknown folder.');
  return {
    messages: listMail(user.id, folder as Folder | 'starred', url.searchParams.get('q') ?? undefined),
    unread: unreadCounts(user.id),
  };
});
