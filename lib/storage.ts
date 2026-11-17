import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './config.ts';
import { all, run } from './db.ts';
import { CLOUD } from './runtime.ts';

/**
 * Where uploaded files (Drive, Sign) are kept: as files in the data folder on a local
 * install, or inside the database in the cloud, where the server's own disk is temporary.
 * Keys are made by databag (e.g. "files/<id>"), never from user input.
 */
const CHUNK = 512 * 1024;
const local = (key: string) => path.join(HOME, ...key.split('/'));
/** Cloud hosts limit request size (Vercel: about 4.5 MB), so uploads are capped there. */
export const MAX_UPLOAD = CLOUD ? 4 * 1024 * 1024 : 200 * 1024 * 1024;

export function putFile(key: string, data: Uint8Array): void {
  if (!CLOUD) { fs.mkdirSync(path.dirname(local(key)), { recursive: true }); fs.writeFileSync(local(key), data); return; }
  run('DELETE FROM blob_chunks WHERE key = ?', key);
  for (let i = 0, n = 0; i < Math.max(1, data.length); i += CHUNK, n++) run('INSERT INTO blob_chunks (key, idx, data) VALUES (?, ?, ?)', key, n, data.subarray(i, i + CHUNK));
}
export function readFile(key: string): Buffer | null {
  if (!CLOUD) return fs.existsSync(local(key)) ? fs.readFileSync(local(key)) : null;
  const parts = all<{ data: Uint8Array }>('SELECT data FROM blob_chunks WHERE key = ? ORDER BY idx', key);
  return parts.length ? Buffer.concat(parts.map((p) => Buffer.from(p.data))) : null;
}
export const fileExists = (key: string) => (CLOUD ? all('SELECT 1 FROM blob_chunks WHERE key = ? LIMIT 1', key).length > 0 : fs.existsSync(local(key)));
export function removeFile(key: string): void {
  if (CLOUD) run('DELETE FROM blob_chunks WHERE key = ?', key);
  else fs.rmSync(local(key), { force: true });
}
