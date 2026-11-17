import { readUpload } from '@/lib/apps/drive';
import { authed } from '@/lib/http';

/** Download a file. Always sent as an attachment so uploaded HTML can never run in the app's origin. */
export const GET = authed<{ id: string }>(({ params }) => {
  const { file, data } = readUpload(params.id);
  return new Response(new Uint8Array(data), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'x-content-type-options': 'nosniff',
    },
  });
});
