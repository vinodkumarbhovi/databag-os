import { after } from 'next/server';
import { runDueJobs } from '@/lib/jobs';
import { CLOUD } from '@/lib/runtime';
import { accounting } from '@/lib/apps/accounting';
import { activity } from '@/lib/apps/activity';
import { agents } from '@/lib/apps/agents';
import { factories } from '@/lib/apps/factories';
import { booking } from '@/lib/apps/booking';
import { books } from '@/lib/apps/books';
import { calendar } from '@/lib/apps/calendar';
import { chat } from '@/lib/apps/chat';
import { crm } from '@/lib/apps/crm';
import { drive } from '@/lib/apps/drive';
import { meet } from '@/lib/apps/meet';
import { office } from '@/lib/apps/office';
import { linkedin } from '@/lib/apps/linkedin';
import { projects } from '@/lib/apps/projects';
import { sign } from '@/lib/apps/sign';
import { tax } from '@/lib/apps/tax';
import { listUsers } from '@/lib/auth';
import { loadConfig } from '@/lib/config';
import { authed } from '@/lib/http';
import type { Handlers } from '@/lib/rpc';

const HANDLERS: Handlers = { ...calendar, ...chat, ...meet, ...office, ...drive, ...crm, ...accounting, ...projects, ...tax, ...sign, ...booking, ...books, ...linkedin, ...agents, ...factories, ...activity,
  // The company directory: everyone with a mailbox here.
  'contacts.team': () => listUsers().map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
};
// Which installed app a handler belongs to ("acc.summary" -> accounting, "office.*" -> any of the three).
const APP_OF: Record<string, string[]> = { calendar: ['calendar'], chat: ['chat'], meet: ['meet', 'calendar'], office: ['docs', 'sheets', 'slides', 'drive'], drive: ['drive'], crm: ['crm', 'accounting', 'contacts'], acc: ['accounting', 'crm'], projects: ['projects'], booking: ['calendar'], li: ['linkedin'], books: ['accounting'], tax: ['tax'], sign: ['sign'], contacts: ['contacts'], agents: ['agents', 'factories'], factories: ['factories'], activity: ['activity', 'agents', 'factories'] };

export const POST = authed(async ({ req, user }) => {
  const { fn, args } = (await req.json()) as { fn: string; args?: unknown };
  const handler = Object.hasOwn(HANDLERS, fn) ? HANDLERS[fn] : undefined;
  const installed = loadConfig().apps;
  if (!handler || !APP_OF[fn.split('.')[0]]?.some((a) => installed.includes(a))) return Response.json({ error: 'That feature is not installed.' }, { status: 404 });
  // In the cloud, use of the app is also what moves scheduled work along (at most every few minutes).
  if (CLOUD) after(() => runDueJobs().catch(() => {}));
  return { result: (await handler(user, args ?? {})) ?? null };
});

// AI calls can take a while; serverless hosts stop a request after this many seconds.
export const maxDuration = 120;
