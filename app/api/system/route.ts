import { authed } from '@/lib/http';
import { machine } from '@/lib/today';

export const GET = authed(async () => ({ ...(await machine()), uptimeSec: Math.round(process.uptime()) }));
