import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { all, run } from './db.ts';

/**
 * The company event log. Every app writes what happened here and any app can
 * react to it — this is the wiring that connects the apps to each other.
 */
export type CompanyEvent = {
  id: string;
  type: string;
  app: string;
  user_id: string | null;
  summary: string;
  payload: Record<string, unknown>;
  created_at: number;
};

// On globalThis so every bundled entry point shares the same bus.
const store = globalThis as typeof globalThis & { __databagBus?: EventEmitter };
const bus = (store.__databagBus ??= new EventEmitter());

export function emit(event: { type: string; app: string; userId?: string; summary: string; payload?: Record<string, unknown> }): void {
  const full: CompanyEvent = {
    id: crypto.randomUUID(),
    type: event.type,
    app: event.app,
    user_id: event.userId ?? null,
    summary: event.summary,
    payload: event.payload ?? {},
    created_at: Date.now(),
  };
  run(
    'INSERT INTO events (id, type, app, user_id, summary, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    full.id, full.type, full.app, full.user_id, full.summary, JSON.stringify(full.payload), full.created_at,
  );
  bus.emit(full.type, full);
}

export function on(type: string, handler: (event: CompanyEvent) => void): void {
  bus.on(type, handler);
}

export function recentEvents(userId: string, limit = 20): CompanyEvent[] {
  return all<Omit<CompanyEvent, 'payload'> & { payload: string }>(
    'SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit,
  ).map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}
