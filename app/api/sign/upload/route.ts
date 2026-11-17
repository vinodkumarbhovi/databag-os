import { saveSignUpload } from '@/lib/apps/sign';
import { loadConfig } from '@/lib/config';
import { authed } from '@/lib/http';

export const POST = authed(async ({ req, user }) => {
  if (!loadConfig().apps.includes('sign')) throw new Error('That feature is not installed.');
  const file = (await req.formData()).get('file');
  if (!(file instanceof File)) throw new Error('Choose a PDF file.');
  return { id: await saveSignUpload(user, file) };
});
