import { runDueJobs } from '@/lib/jobs';

/** Called on a schedule by the host (Vercel Cron, or any cron with the secret) to run due work. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Not allowed.' }, { status: 401 });
  return Response.json(await runDueJobs(true));
}

// AI calls can take a while; serverless hosts stop a request after this many seconds.
export const maxDuration = 120;
