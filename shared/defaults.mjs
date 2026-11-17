// Default configuration, shared by the CLI installer and the server.
import os from 'node:os';
import path from 'node:path';
import { CATALOG } from './catalog.mjs';

/** Where databag keeps its config, database and files. */
export function homeDir() {
  if (process.env.DATABAG_HOME) return path.resolve(process.env.DATABAG_HOME);
  // Serverless hosts only allow writing to /tmp; the real data lives in the hosted database.
  if (process.env.VERCEL) return '/tmp/databag';
  return path.join(os.homedir(), '.databag-os');
}

export const DEFAULTS = {
  company: { name: 'My Company', domain: 'company.local' },
  apps: CATALOG.filter((a) => a.status === 'available').map((a) => a.id),
  host: '127.0.0.1',
  port: 4100,
  currency: 'EUR',
  smtp: { host: '127.0.0.1', port: 2525 },
  // Any OpenAI-compatible endpoint. The default is a local Ollama: no cloud, no API key.
  ai: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'gemma4:e4b', extraBody: { reasoning_effort: 'none' } },
};
