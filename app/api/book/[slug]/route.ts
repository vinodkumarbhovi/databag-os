import { book, publicPage, slotsFor } from '@/lib/apps/booking';
import { open } from '@/lib/http';

/** Free times on a booking page. Public: the link itself is what people share. */
export const GET = open<{ slug: string }>(({ params }) => {
  const found = publicPage(params.slug);
  if (!found) return Response.json({ error: 'This booking page is not available.' }, { status: 404 });
  return { slots: slotsFor(found.page) };
});

export const POST = open<{ slug: string }>(async ({ req, params }) => {
  const body = (await req.json()) as { start: number; name: string; email: string; note?: string };
  return book(params.slug, body);
});
