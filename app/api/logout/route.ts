import { endSession } from '@/lib/auth';
import { open } from '@/lib/http';
import { clearSession, sessionToken } from '@/lib/session';

export const POST = open(async () => {
  const token = await sessionToken();
  if (token) endSession(token);
  await clearSession();
});
