import { createUser, listUsers } from '@/lib/auth';
import { loadConfig } from '@/lib/config';
import { authed } from '@/lib/http';

export const GET = authed(() => ({ users: listUsers() }));

/** Admins add colleagues. Each one gets a mailbox at the company domain. */
export const POST = authed(async ({ req, user }) => {
  if (user.role !== 'admin') return Response.json({ error: 'Only an admin can add people.' }, { status: 403 });
  const body = (await req.json()) as { name?: string; handle?: string; password?: string };
  const handle = body.handle?.trim().toLowerCase();
  if (!handle || !/^[a-z0-9._-]+$/.test(handle)) throw new Error('The email name can use letters, numbers, dots and dashes.');
  const created = createUser({ email: `${handle}@${loadConfig().company.domain}`, name: body.name ?? '', password: body.password ?? '' });
  return { user: created };
});
