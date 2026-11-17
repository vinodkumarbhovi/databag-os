import { authed } from '@/lib/http';
import { search } from '@/lib/search';

export const GET = authed(({ req, user }) => {
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 200);
  return { hits: search(user, q) };
});
