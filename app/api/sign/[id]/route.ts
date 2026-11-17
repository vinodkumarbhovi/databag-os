import { readSignFile } from '@/lib/apps/sign';
import { authed } from '@/lib/http';

/** Download the original PDF, or with ?signed=1 the signed copy with its certificate page. */
export const GET = authed<{ id: string }>(({ req, user, params }) => {
  const { name, data } = readSignFile(user, params.id, new URL(req.url).searchParams.has('signed'));
  return new Response(new Uint8Array(data), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'x-content-type-options': 'nosniff' },
  });
});
