import { ask, decide, toolCatalog } from '@/lib/agent/agent';
import { authed } from '@/lib/http';

/** What the agent can do, for the help text in the panel. */
export const GET = authed(() => ({ tools: toolCatalog() }));

/** Ask the agent something, or answer a waiting approval. */
export const POST = authed(async ({ req, user }) => {
  const b = (await req.json()) as { conversation?: string; message?: string; app?: string; agent?: string; pending?: string; approve?: boolean; edits?: Record<string, string> };
  if (b.pending) return decide(user, { conversation: b.conversation ?? '', pending: b.pending, approve: !!b.approve, edits: b.edits });
  return ask(user, { conversation: b.conversation, message: b.message ?? '', app: b.app, agent: b.agent });
});

// AI calls can take a while; serverless hosts stop a request after this many seconds.
export const maxDuration = 120;
