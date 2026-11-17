import crypto from 'node:crypto';
import path from 'node:path';
import type { User } from '../auth.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { MAX_UPLOAD, putFile, readFile, removeFile } from '../storage.ts';
import { type Handlers, need } from '../rpc.ts';

type DriveFile = { id: string; owner_id: string; name: string; mime: string; size: number; created_at: number };
const MAX_BYTES = MAX_UPLOAD;
/** File contents live on disk under their id, so a file name can never escape the folder. */
const key = (id: string) => `files/${id}`;

export async function saveUpload(user: User, file: File): Promise<string> {
  need(file.size <= MAX_BYTES, `${file.name} is larger than ${Math.round(MAX_BYTES / 1048576)} MB.`);
  const id = crypto.randomUUID();
  putFile(key(id), Buffer.from(await file.arrayBuffer()));
  const name = path.basename(file.name) || 'file';
  run('INSERT INTO drive_files (id, owner_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, user.id, name, file.type || 'application/octet-stream', file.size, Date.now());
  emit({ type: 'drive.uploaded', app: 'drive', userId: user.id, summary: `You uploaded "${name}"`, payload: { fileId: id } });
  return id;
}

export function readUpload(id: string): { file: DriveFile; data: Buffer } {
  const file = get<DriveFile>('SELECT * FROM drive_files WHERE id = ?', id);
  const data = file ? readFile(key(file.id)) : null;
  need(file && data, 'That file does not exist.');
  return { file, data };
}

export const drive: Handlers = {
  'drive.list': (_u, { q }: { q?: string }) =>
    all(
      `SELECT f.id, f.name, f.mime, f.size, f.created_at, f.owner_id, u.name AS owner FROM drive_files f JOIN users u ON u.id = f.owner_id
       WHERE f.name LIKE ? ORDER BY f.created_at DESC`, `%${(q ?? '').replace(/[%_]/g, '')}%`,
    ),
  'drive.remove': (u, { id }: { id: string }) => {
    const file = get<DriveFile>('SELECT * FROM drive_files WHERE id = ?', id);
    need(file, 'That file does not exist.');
    need(file.owner_id === u.id || u.role === 'admin', 'Only the person who uploaded this file, or an admin, can delete it.');
    removeFile(key(file.id));
    run('DELETE FROM drive_files WHERE id = ?', id);
  },
};
