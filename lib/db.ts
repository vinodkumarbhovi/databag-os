import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { HOME } from './config.ts';
import { SCHEMA } from './schema.ts';

type Param = null | number | bigint | string | Uint8Array;
type Statement = { all: (...p: Param[]) => unknown[]; get: (...p: Param[]) => unknown; run: (...p: Param[]) => unknown };
type Handle = { exec: (sql: string) => void; prepare: (sql: string) => Statement };

/**
 * One SQL database for every app. Two places it can live:
 * - a file on this computer (Mac Mini, laptop, VM, Docker volume), using Node's built-in SQLite;
 * - a hosted libSQL/Turso database (DATABASE_URL), used in the cloud, where several servers
 *   share it. Queries go straight to it (no local copy: libSQL's local copies proved unreliable
 *   when tables are created), so every server always sees the same data.
 * Both speak SQLite, so every app runs the same queries either way.
 */
const store = globalThis as typeof globalThis & { __databagDb?: Handle };
const remoteUrl = () => process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
const requireHere = createRequire(import.meta.url);

function open(): Handle {
  fs.mkdirSync(HOME, { recursive: true });
  const url = remoteUrl();
  if (url) {
    const Database = requireHere('libsql') as new (file: string, opts: object) => Handle;
    // Turso hands out libsql:// addresses; the same database answers over https.
    return new Database(url.replace(/^libsql:\/\//, 'https://'), { authToken: process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN });
  }
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
  const handle = new DatabaseSync(path.join(HOME, 'databag.db')) as unknown as Handle;
  handle.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return handle;
}

export function db(): Handle {
  if (!store.__databagDb) {
    const handle = open();
    handle.exec('CREATE TABLE IF NOT EXISTS _migrations (module TEXT PRIMARY KEY, version INTEGER NOT NULL)');
    for (const { module, steps } of SCHEMA) migrate(handle, module, steps);
    store.__databagDb = handle;
  }
  return store.__databagDb;
}
export const usingHostedDb = () => !!remoteUrl();

/** Apply a module's schema steps that have not run yet. */
function migrate(handle: Handle, module: string, steps: string[]): void {
  const row = handle.prepare('SELECT version FROM _migrations WHERE module = ?').get(module) as { version: number } | undefined;
  for (let i = row?.version ?? 0; i < steps.length; i++) {
    handle.exec('BEGIN');
    try {
      handle.exec(steps[i]);
      handle
        .prepare('INSERT INTO _migrations (module, version) VALUES (?, ?) ON CONFLICT(module) DO UPDATE SET version = excluded.version')
        .run(module, i + 1);
      handle.exec('COMMIT');
    } catch (err) {
      handle.exec('ROLLBACK');
      throw err;
    }
  }
}

// libSQL adds a _metadata field to rows; drop it so both drivers return the same rows.
const clean = <T>(row: unknown): T => { if (row && typeof row === 'object' && '_metadata' in row) delete (row as { _metadata?: unknown })._metadata; return row as T; };
export const all = <T>(sql: string, ...params: Param[]) => (db().prepare(sql).all(...params) as unknown[]).map((r) => clean<T>(r));
export const get = <T>(sql: string, ...params: Param[]) => clean<T | undefined>(db().prepare(sql).get(...params));
export const run = (sql: string, ...params: Param[]) => db().prepare(sql).run(...params);
