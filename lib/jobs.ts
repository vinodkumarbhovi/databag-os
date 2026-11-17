import { loadConfig } from './config.ts';
import { get, run } from './db.ts';

/**
 * Work that happens on a schedule: recurring invoices, payment reminders and scheduled
 * LinkedIn posts. On a local install timers run it; in the cloud nothing runs between
 * requests, so a cron call (/api/cron) and ordinary use of the app trigger it instead.
 */
const MIN_GAP = 2 * 60_000;

export async function runDueJobs(force = false): Promise<{ ran: boolean; results?: Record<string, unknown> }> {
  const last = Number(get<{ value: string }>("SELECT value FROM app_kv WHERE key = 'jobs_last_run'")?.value ?? 0);
  if (!force && Date.now() - last < MIN_GAP) return { ran: false };
  run("INSERT INTO app_kv (key, value) VALUES ('jobs_last_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(Date.now()));
  const apps = loadConfig().apps;
  const results: Record<string, unknown> = {};
  if (apps.includes('accounting')) results.accounting = await (await import('./apps/accounting.ts')).runAccountingJobs().catch((e) => ({ error: e.message }));
  if (apps.includes('linkedin')) results.linkedin = await (await import('./apps/linkedin.ts')).runLinkedInJobs().catch((e) => ({ error: e.message }));
  return { ran: true, results };
}
