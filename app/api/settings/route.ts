import fs from 'node:fs';
import path from 'node:path';
import { run } from '@/lib/db';
import { JOBS, TOOLS } from '@/lib/catalog';
import { aiFromEnv, loadConfig, saveConfig } from '@/lib/config';
import { authed } from '@/lib/http';

/** Change your own name, and (admins) the company name, setup choices and backup folder. */
export const PATCH = authed(async ({ req, user }) => {
  const b = (await req.json()) as { myName?: string; company?: string; tools?: string[]; shortcuts?: string[]; backupDir?: string; agentConfirm?: 'send' | 'all'; speechCleanup?: boolean;
    accent?: string | null; ai?: { provider: 'local' | 'openrouter' | 'openai' | 'custom'; baseUrl?: string; model: string; apiKey?: string } };
  if (b.myName !== undefined) {
    if (!b.myName.trim()) throw new Error('Your name cannot be empty.');
    run('UPDATE users SET name = ? WHERE id = ?', b.myName.trim().slice(0, 100), user.id);
  }
  const wantsAdmin = b.company !== undefined || b.tools !== undefined || b.shortcuts !== undefined || b.backupDir !== undefined || b.agentConfirm !== undefined || b.speechCleanup !== undefined || b.accent !== undefined || b.ai !== undefined;
  if (!wantsAdmin) return { ok: true };
  if (user.role !== 'admin') return Response.json({ error: 'Only an admin can change company settings.' }, { status: 403 });
  const config = loadConfig();
  if (b.company !== undefined) {
    if (!b.company.trim()) throw new Error('The company needs a name.');
    config.company.name = b.company.trim().slice(0, 100);
  }
  if (b.tools) config.tools = b.tools.filter((id) => TOOLS.some((t) => t.id === id));
  if (b.shortcuts) config.shortcuts = b.shortcuts.filter((id) => JOBS.some((j) => j.id === id));
  if (b.backupDir !== undefined) {
    const dir = b.backupDir.trim();
    if (dir) {
      if (!path.isAbsolute(dir)) throw new Error('Use a full folder path, like /Volumes/Backup/databag.');
      try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); } catch { throw new Error('databag cannot write to that folder.'); }
    }
    config.backup = { ...config.backup, dir: dir || undefined };
  }
  if (b.agentConfirm) config.agent = { ...config.agent, confirm: b.agentConfirm === 'all' ? 'all' : 'send' };
  if (b.speechCleanup !== undefined) config.speech = { ...config.speech, cleanup: !!b.speechCleanup };
  if (b.accent !== undefined) {
    if (b.accent && !/^#[0-9a-f]{6}$/i.test(b.accent)) throw new Error('Use a colour like #1f6b4f.');
    config.company.accent = b.accent || undefined;
  }
  if (b.ai) {
    if (aiFromEnv()) throw new Error('The AI is set by environment variables on this server. Change them there.');
    const model = b.ai.model?.trim();
    if (!model) throw new Error('Choose a model.');
    const base = { local: 'http://127.0.0.1:11434/v1', openrouter: 'https://openrouter.ai/api/v1', openai: 'https://api.openai.com/v1' }[b.ai.provider as string] ?? b.ai.baseUrl?.trim().replace(/\/$/, '');
    if (!base || !/^https?:\/\//.test(base)) throw new Error('Enter the AI endpoint address, like http://127.0.0.1:1234/v1.');
    const sameProvider = config.ai.baseUrl === base;
    const apiKey = b.ai.apiKey?.trim() || (sameProvider ? config.ai.apiKey : undefined);
    if (/openrouter\.ai|api\.openai\.com/.test(base) && !apiKey) throw new Error('Add the API key for this provider.');
    config.ai = { ...config.ai, baseUrl: base, model, apiKey, extraBody: b.ai.provider === 'local' ? { reasoning_effort: 'none' } : {} };
  }
  saveConfig(config);
  return { ok: true };
});
