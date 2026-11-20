import crypto from 'node:crypto';
import { all, run } from '../db.ts';

/**
 * The agent activity log. Every tool an agent uses is written here, with whether it
 * worked; actions waiting for approval stay "waiting" until someone decides.
 * Status: done | failed | waiting | approved | declined | requested (an access request).
 */
export type ActivityStatus = 'done' | 'failed' | 'waiting' | 'approved' | 'declined';
export type Activity = {
  id: string; agent_id: string | null; agent_name: string; user_id: string; conversation: string | null;
  tool: string; app: string; risk: string; summary: string; status: ActivityStatus; detail: string;
  pending_id: string | null; link: string | null; decided_by: string | null; decided_at: number | null; created_at: number;
};

export function logActivity(a: { agentId?: string | null; agentName: string; userId: string; conversation?: string; tool: string; app: string; risk: string; summary: string; status: ActivityStatus; detail?: string; pendingId?: string; link?: string }): void {
  try {
    run(`INSERT INTO agent_activity (id, agent_id, agent_name, user_id, conversation, tool, app, risk, summary, status, detail, pending_id, link, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), a.agentId ?? null, a.agentName, a.userId, a.conversation ?? null, a.tool, a.app, a.risk, a.summary.slice(0, 400),
      a.status, (a.detail ?? '').slice(0, 1000), a.pendingId ?? null, a.link ?? null, Date.now());
  } catch { /* logging must never break the agent */ }
}

/** Record the decision on a waiting action. */
export function decideActivity(pendingId: string, approved: boolean, userId: string): void {
  run("UPDATE agent_activity SET status = ?, decided_by = ?, decided_at = ? WHERE pending_id = ? AND status = 'waiting'", approved ? 'approved' : 'declined', userId, Date.now(), pendingId);
}

export const listActivity = (f: { agent?: string; status?: string; limit?: number }) =>
  all<Activity & { decided_by_name: string | null; user_name: string | null }>(
    `SELECT a.*, d.name AS decided_by_name, u.name AS user_name FROM agent_activity a
     LEFT JOIN users d ON d.id = a.decided_by LEFT JOIN users u ON u.id = a.user_id
     WHERE (? = '' OR COALESCE(a.agent_id, 'assistant') = ?) AND (? = '' OR a.status = ?)
     ORDER BY a.created_at DESC LIMIT ?`,
    f.agent ?? '', f.agent ?? '', f.status ?? '', f.status ?? '', Math.min(500, f.limit ?? 200));
