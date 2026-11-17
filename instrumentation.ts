// Runs once when the server boots: start the background services apps need.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // In the cloud nothing may run between requests: jobs run from /api/cron instead, and there is no mail server.
  const { CLOUD } = await import('./lib/runtime.ts');
  if (CLOUD) return;
  const { loadConfig } = await import('./lib/config.ts');
  const { scheduleBackups } = await import('./lib/backup.ts');
  scheduleBackups();
  if (loadConfig().apps.includes('linkedin')) (await import('./lib/apps/linkedin.ts')).scheduleLinkedIn();
  setTimeout(() => import('./lib/agent/agent.ts').then((m) => m.warmAgent()), 5000);
  if (loadConfig().apps.includes('accounting')) (await import('./lib/apps/accounting.ts')).scheduleAccounting();
  if (loadConfig().apps.includes('mail')) {
    const { startSmtp } = await import('./lib/mail/smtp.ts');
    startSmtp();
  }
}
