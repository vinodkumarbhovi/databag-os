import type { User } from './auth.ts';
import { currentUser } from './session.ts';

type Ctx<P> = { params: Promise<P> };
const fail = (message: string, status: number) => Response.json({ error: message }, { status });
const reply = (out: unknown) => (out instanceof Response ? out : Response.json(out ?? { ok: true }));

/** A route anyone can call. Thrown errors become a JSON error message. */
export function open<P = object>(fn: (a: { req: Request; params: P }) => unknown) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      return reply(await fn({ req, params: await ctx.params }));
    } catch (err) {
      return fail((err as Error).message, 400);
    }
  };
}

/** A route that needs a signed-in user. */
export function authed<P = object>(fn: (a: { req: Request; user: User; params: P }) => unknown) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const user = await currentUser();
      if (!user) return fail('Please sign in.', 401);
      return reply(await fn({ req, user, params: await ctx.params }));
    } catch (err) {
      return fail((err as Error).message, 400);
    }
  };
}
