import crypto from 'node:crypto';
import { all, get, run } from './db.ts';

export type User = { id: string; email: string; name: string; role: 'admin' | 'member'; created_at: number };

const SESSION_DAYS = 30;
const USER_COLS = 'id, email, name, role, created_at';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function userCount(): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
}

export function listUsers(): User[] {
  return all<User>(`SELECT ${USER_COLS} FROM users ORDER BY name`);
}

export function findUserByEmail(email: string): User | undefined {
  return get<User>(`SELECT ${USER_COLS} FROM users WHERE email = ?`, email.trim());
}

export function createUser(input: { email: string; name: string; password: string; role?: User['role'] }): User {
  const email = input.email.trim().toLowerCase();
  if (!/^[a-z0-9._+-]+@[a-z0-9.-]+$/.test(email)) throw new Error('That email address is not valid.');
  if (input.password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (!input.name.trim()) throw new Error('Name is required.');
  if (findUserByEmail(email)) throw new Error(`${email} already exists.`);
  const id = crypto.randomUUID();
  run(
    'INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, email, input.name.trim(), hashPassword(input.password), input.role ?? 'member', Date.now(),
  );
  return get<User>(`SELECT ${USER_COLS} FROM users WHERE id = ?`, id)!;
}

/** Returns a session token, or undefined when the email or password is wrong. */
export function login(email: string, password: string): string | undefined {
  const row = get<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = ?', email.trim());
  if (!row || !verifyPassword(password, row.password_hash)) return undefined;
  return createSession(row.id);
}

export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, Date.now() + SESSION_DAYS * 864e5);
  return token;
}

export function userForSession(token: string | undefined): User | undefined {
  if (!token) return undefined;
  return get<User>(
    `SELECT u.id, u.email, u.name, u.role, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`,
    token, Date.now(),
  );
}

export function endSession(token: string): void {
  run('DELETE FROM sessions WHERE token = ?', token);
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86400;
