/**
 * Where databag is running, worked out from the environment:
 * - local:  a Mac Mini, laptop, VM or Docker container with its own disk (the default);
 * - cloud:  a serverless host such as Vercel, where the disk is temporary and nothing
 *           runs between requests. Data then lives in a hosted database (Turso/libSQL)
 *           and background jobs run on a schedule (Vercel Cron) or when people use the app.
 */
export const CLOUD = process.env.DATABAG_MODE === 'cloud' || (!!process.env.VERCEL && process.env.DATABAG_MODE !== 'local');

/** The address people outside the company use (signing links, booking pages, invitations). */
export function publicUrl(fallbackHost = 'localhost', fallbackPort = 4100): string {
  if (process.env.DATABAG_URL) return process.env.DATABAG_URL.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return `http://${fallbackHost === '0.0.0.0' || fallbackHost === '127.0.0.1' ? 'localhost' : fallbackHost}:${fallbackPort}`;
}

/** The code needed to create the first account on a cloud install. */
export const setupCode = () => process.env.DATABAG_SETUP_CODE || process.env.CRON_SECRET || '';
