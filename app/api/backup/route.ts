import { backupRoot, createBackup, listBackups } from '@/lib/backup';
import { authed } from '@/lib/http';

export const GET = authed(() => ({ folder: backupRoot(), backups: listBackups().map(({ name, created_at, bytes }) => ({ name, created_at, bytes })) }));

export const POST = authed(({ user }) => {
  if (user.role !== 'admin') return Response.json({ error: 'Only an admin can make backups.' }, { status: 403 });
  const { name, created_at, bytes } = createBackup('manual');
  return { name, created_at, bytes };
});
