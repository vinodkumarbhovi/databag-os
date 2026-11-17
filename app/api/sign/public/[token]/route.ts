import { signByToken } from '@/lib/apps/sign';
import { open } from '@/lib/http';

/** Sign through a private link. No account is needed: the link itself is the key. */
export const POST = open<{ token: string }>(async ({ req, params }) => {
  const { name, agree } = (await req.json()) as { name?: string; agree?: boolean };
  if (!agree) throw new Error('Tick the box to confirm you agree to sign.');
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local network';
  await signByToken(params.token, name ?? '', ip);
  return { ok: true };
});
