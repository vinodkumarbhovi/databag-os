import fs from 'node:fs';
import path from 'node:path';
import { CATALOG } from '../shared/catalog.mjs';
import { DEFAULTS as RAW_DEFAULTS, homeDir } from '../shared/defaults.mjs';
import { get, run } from './db.ts';
import { CLOUD } from './runtime.ts';

export type Config = {
  company: {
    name: string; domain: string;
    /** The uploaded logo's type and a version number (the image itself is in storage under brand/logo). */
    logo?: { type: string; v: number };
    /** The company colour, used as the accent for everyone unless they pick their own. */
    accent?: string;
    /** The address people reach this install at, e.g. https://os.acme.com (set by the installer). */
    url?: string;
  };
  apps: string[];
  /** Every app this install has seen; apps added by an update are switched on once. */
  appsKnown?: string[];
  host: string;
  port: number;
  currency: string;
  smtp: { host: string; port: number };
  /** Any OpenAI-compatible endpoint. Defaults to a local Ollama. */
  ai: { baseUrl: string; model: string; apiKey?: string; speechModel?: string; extraBody?: Record<string, unknown> };
  /** Optional outbound relay for mail to addresses outside the company. */
  relay?: { host: string; port: number; secure?: boolean; user?: string; pass?: string };
  /** Mail to the internet: 'direct' (default when no relay) delivers to recipients' mail servers itself; 'off' keeps mail inside the company. */
  mail?: { outbound?: 'direct' | 'off'; mxOverride?: string };
  /** Subscriptions the company used before (ids from TOOLS), to show what can be cancelled. */
  tools?: string[];
  /** Home screen shortcuts (ids from JOBS). */
  shortcuts?: string[];
  /** Where backups go (default: the backups folder in the data directory) and how many to keep. */
  backup?: { dir?: string; keep?: number };
  /** Which agent actions wait for the person's OK: 'send' = anything that reaches other people (default); 'all' = every change. */
  agent?: { confirm?: 'send' | 'all' };
  /** Dictation: tidy up spoken text (filler words, punctuation) before inserting it. */
  speech?: { cleanup?: boolean };
  /** Only for testing against a stand-in LinkedIn: where its API and sign-in pages live. */
  linkedin?: { apiBase?: string; authBase?: string; version?: string };
};

export const HOME = homeDir();
export const DEFAULTS = RAW_DEFAULTS as Config;

const file = () => path.join(HOME, 'config.json');

export function configExists(): boolean {
  return fs.existsSync(file()) || (CLOUD && !!savedInDb());
}

/** In the cloud the disk is temporary, so settings saved from the app are kept in the database. */
function savedInDb(): Partial<Config> | null {
  try { const row = get<{ value: string }>("SELECT value FROM app_kv WHERE key = 'config'"); return row ? JSON.parse(row.value) : null; }
  catch { return null; }
}

/**
 * Settings from the environment always win. They are how a cloud or Docker install is set up
 * without a settings file, and the safe place for secrets such as an AI key.
 */
function fromEnv(): Partial<Config> {
  const e = process.env;
  const out: Partial<Config> = {};
  const key = e.DATABAG_AI_KEY || e.OPENROUTER_API_KEY;
  if (e.DATABAG_AI_BASE_URL || key || e.DATABAG_AI_MODEL || e.DATABAG_SPEECH_MODEL) {
    const openrouter = !e.DATABAG_AI_BASE_URL && !!e.OPENROUTER_API_KEY;
    out.ai = {
      baseUrl: e.DATABAG_AI_BASE_URL || (openrouter ? 'https://openrouter.ai/api/v1' : DEFAULTS.ai.baseUrl),
      model: e.DATABAG_AI_MODEL || (openrouter ? 'google/gemini-2.5-flash' : DEFAULTS.ai.model),
      ...(key ? { apiKey: key } : {}),
      ...(e.DATABAG_SPEECH_MODEL ? { speechModel: e.DATABAG_SPEECH_MODEL } : {}),
      // Ollama understands "reasoning_effort: none"; hosted providers get no extra options unless asked.
      extraBody: (e.DATABAG_AI_BASE_URL || DEFAULTS.ai.baseUrl).includes('11434') && !openrouter ? DEFAULTS.ai.extraBody : {},
    };
  }
  if (e.DATABAG_APPS) out.apps = e.DATABAG_APPS.split(',').map((a) => a.trim()).filter(Boolean);
  if (e.DATABAG_CURRENCY) out.currency = e.DATABAG_CURRENCY;
  if (e.DATABAG_SMTP_HOST || e.DATABAG_SMTP_PORT) out.smtp = { host: e.DATABAG_SMTP_HOST || DEFAULTS.smtp.host, port: Number(e.DATABAG_SMTP_PORT) || DEFAULTS.smtp.port };
  if (e.MAIL_RELAY_HOST) out.relay = { host: e.MAIL_RELAY_HOST, port: Number(e.MAIL_RELAY_PORT) || 587, secure: e.MAIL_RELAY_SECURE === 'true', user: e.MAIL_RELAY_USER, pass: e.MAIL_RELAY_PASS };
  return out;
}

/** Where the company logo is served, or null when there is none. */
export const logoUrl = (c: Config = loadConfig()) => (c.company.logo ? `/api/brand/logo?v=${c.company.logo.v}` : null);
/** Whether the AI settings come from environment variables (then Settings cannot change them). */
export const aiFromEnv = () => !!fromEnv().ai;

export function loadConfig(): Config {
  const saved = (fs.existsSync(file()) ? JSON.parse(fs.readFileSync(file(), 'utf8')) : CLOUD ? savedInDb() ?? {} : {}) as Partial<Config>;
  const env = fromEnv();
  const available = (CATALOG as { id: string; status: string }[]).filter((a) => a.status === 'available').map((a) => a.id);
  const known = saved.appsKnown ?? saved.apps;
  const added = known ? available.filter((id) => !known.includes(id)) : [];
  return {
    ...DEFAULTS,
    ...saved,
    ...(saved.apps && added.length ? { apps: [...saved.apps, ...added] } : {}),
    ...env,
    company: { ...DEFAULTS.company, ...saved.company },
    smtp: { ...DEFAULTS.smtp, ...saved.smtp, ...env.smtp },
    ai: { ...DEFAULTS.ai, ...saved.ai, ...env.ai },
  };
}

export function saveConfig(config: Config): void {
  // Environment settings are not written back: they stay in the environment.
  const env = fromEnv();
  const toSave = { ...config, appsKnown: (CATALOG as { id: string; status: string }[]).filter((a) => a.status === 'available').map((a) => a.id), ...(env.ai ? { ai: { ...DEFAULTS.ai, ...(loadSavedOnly().ai ?? {}) } } : {}), ...(env.relay ? { relay: loadSavedOnly().relay } : {}) };
  if (CLOUD) { run("INSERT INTO app_kv (key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(toSave)); return; }
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(toSave, null, 2) + '\n', { mode: 0o600 });
}
function loadSavedOnly(): Partial<Config> {
  return (fs.existsSync(file()) ? JSON.parse(fs.readFileSync(file(), 'utf8')) : CLOUD ? savedInDb() ?? {} : {}) as Partial<Config>;
}
