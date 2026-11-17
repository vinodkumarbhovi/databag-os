import { authUrl } from '@/lib/apps/linkedin';
import { authed } from '@/lib/http';

/** Send an admin to LinkedIn to approve databag posting for them. */
export const GET = authed(({ req, user }) => {
  if (user.role !== 'admin') return Response.json({ error: 'Only an admin can connect LinkedIn.' }, { status: 403 });
  return Response.redirect(authUrl(req), 302);
});
