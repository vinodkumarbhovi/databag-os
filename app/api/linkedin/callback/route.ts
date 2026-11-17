import { finishAuth, origin } from '@/lib/apps/linkedin';
import { authed } from '@/lib/http';

/** LinkedIn sends the person back here after they approve (or decline). */
export const GET = authed(async ({ req, user }) => {
  const url = new URL(req.url);
  const back = (q: string) => Response.redirect(`${origin(req)}/linkedin?tab=settings&${q}`, 302);
  if (user.role !== 'admin') return back('error=' + encodeURIComponent('Only an admin can connect LinkedIn.'));
  if (url.searchParams.get('error')) return back('error=' + encodeURIComponent(url.searchParams.get('error_description') ?? 'LinkedIn did not connect.'));
  try { await finishAuth(req, url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? ''); return back('connected=1'); }
  catch (err) { return back('error=' + encodeURIComponent((err as Error).message)); }
});
