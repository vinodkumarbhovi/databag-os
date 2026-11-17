import { authed } from '@/lib/http';
import { type SendInput, sendMail } from '@/lib/mail/store';

export const POST = authed(async ({ req, user }) => sendMail(user, (await req.json()) as SendInput));
