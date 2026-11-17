import { authed } from '@/lib/http';
import { machine, needsYou, schedule } from '@/lib/today';

export const GET = authed(async ({ user }) => ({ todos: needsYou(user), schedule: schedule(user), machine: await machine() }));
