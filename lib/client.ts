/** Browser-side helper for calling the databag API. Throws the server's error message. */
export async function call<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: opts.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Something went wrong (${res.status}).`);
  return data as T;
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

export function when(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

/** Call an app's server function, e.g. rpc('calendar.list', { from, to }). */
export async function rpc<T = unknown>(fn: string, args?: unknown): Promise<T> {
  return (await call<{ result: T }>('/api/rpc', { body: { fn, args } })).result;
}

/** Read ?name= from the address bar (used to open a specific file, room or draft). */
export const param = (name: string) => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name));

export const money = (n: number, currency = 'EUR') => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
