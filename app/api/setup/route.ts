import crypto from 'node:crypto';
import { JOBS, TOOLS } from '@/lib/catalog';
import { CLOUD, setupCode } from '@/lib/runtime';
import { createSession, createUser, userCount } from '@/lib/auth';
import { loadConfig, saveConfig } from '@/lib/config';
import { open } from '@/lib/http';
import { setSession } from '@/lib/session';

/** First run only: name the company and create the admin account. */
export const POST = open(async ({ req }) => {
  if (userCount() > 0) throw new Error('This workspace is already set up.');
  const body = (await req.json()) as { company?: string; domain?: string; name?: string; handle?: string; password?: string; tools?: string[]; shortcuts?: string[]; setupCode?: string };
  // On a public address, only the person who deployed databag may create the first account.
  if (CLOUD) {
    const code = setupCode();
    if (!code) throw new Error('Set DATABAG_SETUP_CODE (or CRON_SECRET) in your host’s environment variables first, then redeploy.');
    const a = Buffer.from(body.setupCode ?? ''), b = Buffer.from(code);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('That setup code is not right.');
  }
  const company = body.company?.trim();
  const domain = body.domain?.trim().toLowerCase();
  const handle = body.handle?.trim().toLowerCase();
  if (!company) throw new Error('Company name is required.');
  if (!domain || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new Error('Enter a domain like acme.com.');
  if (!handle || !/^[a-z0-9._-]+$/.test(handle)) throw new Error('Your email name can use letters, numbers, dots and dashes.');

  const user = createUser({ email: `${handle}@${domain}`, name: body.name ?? '', password: body.password ?? '', role: 'admin' });
  saveConfig({
    ...loadConfig(), company: { name: company, domain },
    tools: (body.tools ?? []).filter((id) => TOOLS.some((t) => t.id === id)),
    shortcuts: (body.shortcuts ?? []).filter((id) => JOBS.some((j) => j.id === id)),
  });
  await setSession(createSession(user.id));
  return { user };
});
