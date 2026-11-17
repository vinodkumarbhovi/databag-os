import { exportFile } from '@/lib/apps/office';
import { authed } from '@/lib/http';

export const GET = authed<{ id: string }>(async ({ params }) => {
  const { data, name, mime } = await exportFile(params.id);
  return new Response(data as BodyInit, {
    headers: { 'content-type': mime, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
  });
});
