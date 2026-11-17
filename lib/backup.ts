import fs from 'node:fs';
import path from 'node:path';
import { HOME, loadConfig } from './config.ts';
import { db } from './db.ts';
import { emit } from './events.ts';
import { CLOUD } from './runtime.ts';

/**
 * Backups: a consistent copy of the database (SQLite's VACUUM INTO, safe while the
 * app is running), the settings, and every stored file (Drive, Sign). Each backup is
 * a plain folder, so it can be read or copied without databag. Restoring is done with
 * `databag restore <folder>` while databag is stopped.
 */
export type Backup = { name: string; dir: string; created_at: number; bytes: number };
const FILE_DIRS = ['files', 'sign'];
const DAY = 864e5;

export const backupRoot = () => path.resolve(loadConfig().backup?.dir || path.join(HOME, 'backups'));

function sizeOf(p: string): number {
  const st = fs.statSync(p);
  return st.isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0) : st.size;
}

export function listBackups(): Backup[] {
  if (CLOUD) return [];
  const root = backupRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((n) => /^databag-\d{8}-\d{6}$/.test(n) && fs.existsSync(path.join(root, n, 'databag.db')))
    .map((name) => {
      const dir = path.join(root, name);
      const info = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'backup.json'), 'utf8')); } catch { return {}; } })();
      return { name, dir, created_at: info.created_at ?? fs.statSync(dir).mtimeMs, bytes: info.bytes ?? 0 };
    })
    .sort((a, b) => b.created_at - a.created_at);
}

let running = false;
export function createBackup(reason: 'manual' | 'daily' = 'manual'): Backup {
  if (CLOUD) throw new Error('In the cloud your database host keeps the backups (for example Turso’s point-in-time restore). Use the host’s dashboard to restore.');
  if (running) throw new Error('A backup is already running.');
  running = true;
  const root = backupRoot();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const dir = path.join(root, `databag-${stamp}`);
  try {
    fs.mkdirSync(root, { recursive: true });
    if (path.resolve(root).startsWith(path.resolve(HOME) + path.sep) && FILE_DIRS.some((d) => root.startsWith(path.join(HOME, d)))) throw new Error('Choose a backup folder outside the data it backs up.');
    fs.mkdirSync(dir);
    db().exec(`VACUUM INTO '${path.join(dir, 'databag.db').replace(/'/g, "''")}'`);
    if (fs.existsSync(path.join(HOME, 'config.json'))) fs.copyFileSync(path.join(HOME, 'config.json'), path.join(dir, 'config.json'));
    for (const d of FILE_DIRS) if (fs.existsSync(path.join(HOME, d))) fs.cpSync(path.join(HOME, d), path.join(dir, d), { recursive: true });
    const bytes = sizeOf(dir);
    const created_at = Date.now();
    fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify({ created_at, bytes, reason, version: 1 }, null, 2));
    fs.chmodSync(dir, 0o700);
    // Keep the newest few; older ones are removed.
    const keep = Math.max(1, loadConfig().backup?.keep ?? 7);
    for (const old of listBackups().slice(keep)) fs.rmSync(old.dir, { recursive: true, force: true });
    emit({ type: 'backup.created', app: 'settings', summary: `Backup made (${(bytes / 1048576).toFixed(1)} MB)`, payload: { name: path.basename(dir) } });
    return { name: path.basename(dir), dir, created_at, bytes };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  } finally {
    running = false;
  }
}

/** Make a backup once a day while databag runs. Called once at server start. */
export function scheduleBackups(): void {
  const store = globalThis as typeof globalThis & { __databagBackupTimer?: ReturnType<typeof setInterval> };
  if (store.__databagBackupTimer || CLOUD) return;
  const check = () => {
    try { if (Date.now() - (listBackups()[0]?.created_at ?? 0) > DAY) createBackup('daily'); }
    catch (err) { console.error('databag: daily backup failed:', (err as Error).message); }
  };
  setTimeout(check, 60_000);
  store.__databagBackupTimer = setInterval(check, 60 * 60_000);
  store.__databagBackupTimer.unref?.();
}
