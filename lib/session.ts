import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_MAX_AGE, type User, userCount, userForSession } from './auth.ts';

const COOKIE = 'databag_session';

export async function currentUser(): Promise<User | undefined> {
  return userForSession((await cookies()).get(COOKIE)?.value);
}

/** For pages: the signed-in user, or a redirect to sign-in (or first-run setup). */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(userCount() === 0 ? '/setup' : '/login');
  return user;
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value;
}

export async function setSession(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
