// Development seed: a demo company with three people and a few emails.
// Run with `npm run seed`. These are throwaway local accounts for testing only.
import { createUser, userCount } from '../lib/auth.ts';
import { DEFAULTS, saveConfig } from '../lib/config.ts';
import { sendMail } from '../lib/mail/store.ts';

export const DEMO_PASSWORD = 'databag-demo-2026';
const DOMAIN = 'acme.test';

if (userCount() > 0) {
  console.log('Already seeded — delete the .data folder to start again.');
  process.exit(0);
}

saveConfig({ ...DEFAULTS, company: { name: 'Acme Robotics', domain: DOMAIN } });

const ada = createUser({ email: `ada@${DOMAIN}`, name: 'Ada Okafor', password: DEMO_PASSWORD, role: 'admin' });
const ben = createUser({ email: `ben@${DOMAIN}`, name: 'Ben Carter', password: DEMO_PASSWORD });
const mira = createUser({ email: `mira@${DOMAIN}`, name: 'Mira Shah', password: DEMO_PASSWORD });

await sendMail(ben, {
  to: [ada.email],
  subject: 'Q4 supplier quote — need your sign-off by Friday',
  body: `Hi Ada,\n\nThe quote from Nordic Motors came in at €48,200 for 400 servo units, which is 6% under budget. They can deliver by 12 December if we confirm by this Friday.\n\nTwo things I need from you:\n1. Approval to sign the purchase order.\n2. Whether we want the extended 3-year warranty (+€2,100).\n\nI'd take the warranty — we had four failures last year.\n\nBen`,
});
await sendMail(mira, {
  to: [ada.email],
  cc: [ben.email],
  subject: 'Customer demo moved to Tuesday 10:00',
  body: `Hi both,\n\nHelios Logistics asked to move the demo from Monday to Tuesday at 10:00. I have said yes.\n\nAda, could you join for the first 15 minutes to cover pricing? Ben, please make sure the warehouse robot is charged and on the latest firmware.\n\nThanks,\nMira`,
});
await sendMail(ada, {
  to: [mira.email],
  subject: 'Welcome pack for new hires',
  body: `Hi Mira,\n\nCould you send me the latest welcome pack? Two engineers start on the 1st.\n\nAda`,
});

console.log(`Seeded Acme Robotics. Sign in as ada@${DOMAIN} (password is DEMO_PASSWORD in scripts/seed.ts).`);
