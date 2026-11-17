import { login } from '@/lib/auth';
import { open } from '@/lib/http';
import { setSession } from '@/lib/session';

export const POST = open(async ({ req }) => {
  const { email, password } = (await req.json()) as { email?: string; password?: string };
  const token = login(email ?? '', password ?? '');
  if (!token) return Response.json({ error: 'That email or password is not right.' }, { status: 401 });
  await setSession(token);
});
