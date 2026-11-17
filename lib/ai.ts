import { loadConfig } from './config.ts';

/**
 * The single AI gateway every app calls. It speaks the OpenAI chat format, so
 * it works with a local Ollama (the default) or any compatible endpoint.
 */
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function headers(apiKey?: string, baseUrl = ''): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    // OpenRouter shows these on its usage page; harmless elsewhere.
    ...(baseUrl.includes('openrouter.ai') ? { 'HTTP-Referer': 'https://github.com/databag-os', 'X-Title': 'databag' } : {}),
  };
}
/** Where the AI runs, for error messages: the local model or a hosted provider. */
const where = (baseUrl: string) => (/127\.0\.0\.1|localhost|11434|ollama/.test(baseUrl) ? `The AI model is not reachable at ${baseUrl}. Is Ollama running?` : `The AI service at ${baseUrl} is not reachable.`);
const missingKey = (baseUrl: string, apiKey?: string) => /openrouter\.ai|api\.openai\.com/.test(baseUrl) && !apiKey;

export async function chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const { ai } = loadConfig();
  if (missingKey(ai.baseUrl, ai.apiKey)) throw new Error(`No API key is set for ${new URL(ai.baseUrl).host}. Add it in Settings → AI.`);
  let res: Response;
  try {
    res = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(ai.apiKey, ai.baseUrl),
      body: JSON.stringify({
        model: ai.model,
        messages,
        stream: false,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 700,
        ...ai.extraBody,
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new Error(where(ai.baseUrl));
  }
  if (!res.ok) throw new Error(`The AI model returned an error (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('The AI model returned an empty answer.');
  return text;
}

/** One message in the OpenAI tool-calling format. */
export type AgentMessage =
  | { role: 'system' | 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ContentPart = { type: 'text'; text: string } | { type: 'input_audio'; input_audio: { data: string; format: 'wav' } };
export type ToolSpec = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };

/** A chat turn that may ask for tools to be run. Used by the agent and by speech-to-text. */
export type AiOverride = { baseUrl?: string; model?: string; apiKey?: string };
/** An agent may use its own provider or model; anything it leaves out comes from the company settings. */
function pick(override?: AiOverride) {
  const base = loadConfig().ai;
  if (!override || (!override.baseUrl && !override.model)) return base;
  if (!override.baseUrl || override.baseUrl === base.baseUrl) return { ...base, model: override.model || base.model, ...(override.apiKey ? { apiKey: override.apiKey } : {}) };
  return { baseUrl: override.baseUrl.replace(/\/$/, ''), model: override.model || base.model, apiKey: override.apiKey, extraBody: /11434/.test(override.baseUrl) ? base.extraBody : {} } as typeof base;
}

export async function chatWithTools(messages: AgentMessage[], opts: { tools?: ToolSpec[]; temperature?: number; maxTokens?: number; speech?: boolean; ai?: AiOverride } = {}): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const ai = pick(opts.ai);
  if (missingKey(ai.baseUrl, ai.apiKey)) throw new Error(`No API key is set for ${new URL(ai.baseUrl).host}. Add it in Settings → AI.`);
  let res: Response;
  try {
    res = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(ai.apiKey, ai.baseUrl),
      body: JSON.stringify({
        model: (opts.speech && ai.speechModel) || ai.model, messages, stream: false,
        temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens ?? 900,
        ...(opts.tools?.length ? { tools: opts.tools } : {}),
        ...ai.extraBody,
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new Error(where(ai.baseUrl));
  }
  if (!res.ok) throw new Error(`The AI model returned an error (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
  const msg = data.choices?.[0]?.message;
  return { content: msg?.content?.trim() ?? '', toolCalls: (msg?.tool_calls ?? []).map((t, i) => ({ ...t, id: t.id || `call_${i}`, type: 'function' })) };
}

export async function aiHealth(): Promise<{ ok: boolean; model: string; baseUrl: string; installed: boolean; models: string[] }> {
  const { ai } = loadConfig();
  try {
    const res = await fetch(`${ai.baseUrl}/models`, { headers: headers(ai.apiKey, ai.baseUrl), signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { data?: { id: string }[] };
    const models = (data.data ?? []).map((m) => m.id);
    return { ok: true, model: ai.model, baseUrl: ai.baseUrl, installed: models.includes(ai.model), models };
  } catch {
    return { ok: false, model: ai.model, baseUrl: ai.baseUrl, installed: false, models: [] };
  }
}
