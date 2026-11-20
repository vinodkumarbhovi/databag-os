import { decide } from '../agent/agent.ts';
import { listActivity } from '../agent/activity.ts';
import { all, get } from '../db.ts';
import { type Handlers, need } from '../rpc.ts';
import { factories } from './factories.ts';

/**
 * Activity: what every agent did, is doing and is waiting for. Admins see all agents;
 * everyone else sees the work done for them. Waiting actions and access requests can
 * be approved or declined here, wherever they started (a chat, Today, a factory task).
 */
export const activity: Handlers = {
  'activity.list': (u, { agent, status }: { agent?: string; status?: string }) => {
    const rows = listActivity({ agent: agent ?? '', status: status ?? '', limit: 300 });
    return u.role === 'admin' ? rows : rows.filter((r) => r.user_id === u.id);
  },

  /** One line per agent: how much it did, what failed, what waits. */
  'activity.summary': (u) => {
    const mine = u.role === 'admin' ? '' : u.id;
    const since = Date.now() - 7 * 864e5;
    const stats = all<{ agent: string; name: string; total: number; failed: number; waiting: number; last: number }>(
      `SELECT COALESCE(agent_id, 'assistant') AS agent, MAX(agent_name) AS name, COUNT(*) AS total,
         SUM(status = 'failed') AS failed, SUM(status = 'waiting') AS waiting, MAX(created_at) AS last
       FROM agent_activity WHERE created_at > ? AND (? = '' OR user_id = ?) GROUP BY COALESCE(agent_id, 'assistant') ORDER BY last DESC`, since, mine, mine);
    return { stats, agents: all<{ id: string; name: string }>('SELECT id, name FROM agents ORDER BY name') };
  },

  'activity.decide': async (u, { id, approve, edits }: { id: string; approve: boolean; edits?: Record<string, string> }) => {
    const row = get<{ conversation: string; pending_id: string; status: string; user_id: string }>('SELECT conversation, pending_id, status, user_id FROM agent_activity WHERE id = ?', id);
    need(row && row.status === 'waiting' && row.pending_id, 'This has already been decided.');
    need(row.user_id === u.id || u.role === 'admin', 'Only the person it is for, or an admin, can decide this.');
    // A factory task keeps its own copy of the waiting action; let the factory record the outcome.
    const task = get<{ id: string }>('SELECT id FROM proj_tasks WHERE agent_conversation = ? AND agent_state = ?', row.conversation, 'waiting');
    if (task) return factories['factories.decide'](u, { id: task.id, approve, edits });
    const turn = await decide(u, { conversation: row.conversation, pending: row.pending_id, approve, edits });
    return { reply: turn.reply, pending: !!turn.pending };
  },
};
