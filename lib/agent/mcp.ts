/**
 * A small client for MCP servers reached over HTTP ("Streamable HTTP" transport).
 * An agent can be given MCP servers; their tools then appear next to databag's own.
 * Only remote (HTTP) servers are supported, so nobody can start programs on the
 * databag machine from the web page.
 */
export type McpServer = { name: string; url: string; token?: string; approve?: boolean };
export type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };

const VERSION = '2025-06-18';
const sessions = new Map<string, string>();
const toolCache = new Map<string, { at: number; tools: McpTool[] }>();

async function send(s: McpServer, body: Record<string, unknown>, session?: string): Promise<{ result?: unknown; session?: string }> {
  const res = await fetch(s.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': VERSION,
      ...(s.token ? { authorization: `Bearer ${s.token}` } : {}),
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const next = res.headers.get('mcp-session-id') ?? session;
  if (!('id' in body)) return { session: next }; // a notification: no answer expected
  if (!res.ok) throw new Error(`The MCP server "${s.name}" answered ${res.status}.`);
  const text = await res.text();
  // The answer is either plain JSON or a short event stream whose data lines hold the JSON.
  const messages = (res.headers.get('content-type') ?? '').includes('text/event-stream')
    ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
    : [JSON.parse(text)];
  const reply = messages.find((m) => m && m.id === body.id);
  if (!reply) throw new Error(`The MCP server "${s.name}" did not answer.`);
  if (reply.error) throw new Error(`MCP "${s.name}": ${reply.error.message ?? 'error'}`);
  return { result: reply.result, session: next };
}

let ids = 0;
async function request(s: McpServer, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const key = `${s.url}|${s.token ?? ''}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let session = sessions.get(key);
    if (!session) {
      const init = await send(s, { jsonrpc: '2.0', id: ++ids, method: 'initialize', params: { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 'databag', version: '0.1' } } });
      session = init.session ?? '';
      await send(s, { jsonrpc: '2.0', method: 'notifications/initialized' }, session || undefined);
      sessions.set(key, session);
    }
    try {
      return (await send(s, { jsonrpc: '2.0', id: ++ids, method, params }, session || undefined)).result;
    } catch (err) {
      // The server may have forgotten the session (restart): start a new one once.
      sessions.delete(key);
      if (attempt) throw err;
    }
  }
}

/** The tools an MCP server offers. Kept for five minutes. */
export async function listMcpTools(s: McpServer, fresh = false): Promise<McpTool[]> {
  const key = `${s.url}|${s.token ?? ''}`;
  const hit = toolCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 300_000) return hit.tools;
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r = (await request(s, 'tools/list', cursor ? { cursor } : {})) as { tools?: McpTool[]; nextCursor?: string };
    tools.push(...(r?.tools ?? []));
    if (!r?.nextCursor) break;
    cursor = r.nextCursor;
  }
  toolCache.set(key, { at: Date.now(), tools });
  return tools;
}

/** Call one MCP tool and return its text (and any structured result). */
export async function callMcpTool(s: McpServer, name: string, args: Record<string, unknown>): Promise<unknown> {
  const r = (await request(s, 'tools/call', { name, arguments: args })) as { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };
  const text = (r?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').slice(0, 6000);
  if (r?.isError) return { error: text || 'The tool failed.' };
  return r?.structuredContent ? { text, data: r.structuredContent } : { text };
}

/** A tool name the model accepts: letters, digits, _ and -, at most 64 characters. */
export const mcpToolName = (server: string, tool: string) =>
  `mcp_${server.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20)}_${tool.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 64);
