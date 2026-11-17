import { recentEvents } from '@/lib/events';
import { authed } from '@/lib/http';

export const GET = authed(({ user }) => ({ events: recentEvents(user.id, 15) }));
