import type { User } from './auth.ts';

/**
 * Apps expose their server functions as named handlers ("calendar.list").
 * One endpoint (/api/rpc) calls them, always with the signed-in user.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handlers = Record<string, (user: User, args: any) => unknown>;

export function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
