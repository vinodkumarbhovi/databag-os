import { saveUpload } from '@/lib/apps/drive';
import { authed } from '@/lib/http';

export const POST = authed(async ({ req, user }) => {
  const files = (await req.formData()).getAll('file').filter((f): f is File => f instanceof File);
  if (!files.length) throw new Error('Choose a file to upload.');
  const ids = [];
  for (const file of files) ids.push(await saveUpload(user, file));
  return { ids };
});
