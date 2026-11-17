import { importFile } from '@/lib/apps/office';
import { authed } from '@/lib/http';

export const POST = authed(async ({ req, user }) => {
  const file = (await req.formData()).get('file');
  if (!(file instanceof File)) throw new Error('Choose a file to import.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That file is larger than 25 MB.');
  return importFile(user, file.name, Buffer.from(await file.arrayBuffer()));
});
