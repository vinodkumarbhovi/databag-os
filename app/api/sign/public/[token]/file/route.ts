import { readByToken } from '@/lib/apps/sign';
import { open } from '@/lib/http';

/** The PDF behind a signing link, shown in the browser's own PDF viewer. */
export const GET = open<{ token: string }>(({ params }) => {
  const data = readByToken(params.token);
  if (!data) return Response.json({ error: 'This signing link is not valid.' }, { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'", 'cache-control': 'private, no-store' },
  });
});
