import crypto from 'node:crypto';
import { chat as ai } from '../ai.ts';
import { listUsers } from '../auth.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { type Handlers, need } from '../rpc.ts';

export const STATUSES = ['todo', 'doing', 'done'];
type Task = { id: string; project_id: string; title: string; notes: string; status: string; assignee_id: string | null; due_at: number | null };

function addTask(userId: string, t: { project_id: string; title: string; notes?: string; assignee_id?: string | null; due_at?: number | null }): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  run('INSERT INTO proj_tasks (id, project_id, title, notes, assignee_id, due_at, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, t.project_id, t.title.trim().slice(0, 300), t.notes ?? '', t.assignee_id || null, t.due_at || null, now, userId, now, now);
  return id;
}

export const projects: Handlers = {
  /** Projects with how much is left in each, plus the people tasks can be given to. */
  'projects.list': () => ({
    projects: all(
      `SELECT p.id, p.name, p.description, COUNT(t.id) AS total, COALESCE(SUM(t.status != 'done'), 0) AS open
       FROM proj_projects p LEFT JOIN proj_tasks t ON t.project_id = p.id GROUP BY p.id ORDER BY p.created_at`),
    people: listUsers().map((u) => ({ id: u.id, name: u.name })),
  }),

  'projects.save': (u, p: { id?: string; name: string; description?: string }) => {
    need(p.name?.trim(), 'Give the project a name.');
    if (p.id) { run('UPDATE proj_projects SET name = ?, description = ? WHERE id = ?', p.name.trim(), p.description ?? '', p.id); return { id: p.id }; }
    const id = crypto.randomUUID();
    run('INSERT INTO proj_projects (id, name, description, created_at) VALUES (?, ?, ?, ?)', id, p.name.trim(), p.description ?? '', Date.now());
    emit({ type: 'projects.created', app: 'projects', userId: u.id, summary: `You started the project "${p.name.trim()}"`, payload: { projectId: id } });
    return { id };
  },

  'projects.remove': (_u, { id }: { id: string }) => {
    run('DELETE FROM proj_tasks WHERE project_id = ?', id);
    run('DELETE FROM proj_projects WHERE id = ?', id);
  },

  /** Tasks of one project, or with `mine` every task given to the signed-in person. */
  'projects.tasks': (u, { project_id, mine }: { project_id?: string; mine?: boolean }) =>
    all(
      `SELECT t.*, a.name AS assignee, p.name AS project FROM proj_tasks t JOIN proj_projects p ON p.id = t.project_id LEFT JOIN users a ON a.id = t.assignee_id
       WHERE ${mine ? 't.assignee_id = ?' : 't.project_id = ?'} ORDER BY t.position`, mine ? u.id : project_id ?? ''),

  'projects.saveTask': (u, t: Partial<Task>) => {
    if (!t.id) {
      need(t.title?.trim(), 'What needs doing?');
      need(t.project_id && get('SELECT 1 FROM proj_projects WHERE id = ?', t.project_id), 'Choose a project first.');
      const id = addTask(u.id, { project_id: t.project_id!, title: t.title!, notes: t.notes, assignee_id: t.assignee_id, due_at: t.due_at });
      if (t.assignee_id && t.assignee_id !== u.id) emit({ type: 'projects.assigned', app: 'projects', userId: t.assignee_id, summary: `${u.name} gave you a task: ${t.title!.trim()}`, payload: { taskId: id } });
      return { id };
    }
    const old = get<Task>('SELECT * FROM proj_tasks WHERE id = ?', t.id);
    need(old, 'That task does not exist.');
    const status = t.status ?? old.status;
    need(STATUSES.includes(status), 'Unknown status.');
    const assignee = t.assignee_id === undefined ? old.assignee_id : t.assignee_id || null;
    run('UPDATE proj_tasks SET title = ?, notes = ?, status = ?, assignee_id = ?, due_at = ?, updated_at = ? WHERE id = ?',
      t.title?.trim() || old.title, t.notes ?? old.notes, status, assignee, t.due_at === undefined ? old.due_at : t.due_at || null, Date.now(), t.id);
    if (status === 'done' && old.status !== 'done') emit({ type: 'projects.task.done', app: 'projects', userId: u.id, summary: `Task finished: ${old.title}`, payload: { taskId: t.id } });
    if (assignee && assignee !== old.assignee_id && assignee !== u.id) emit({ type: 'projects.assigned', app: 'projects', userId: assignee, summary: `${u.name} gave you a task: ${old.title}`, payload: { taskId: t.id } });
    return { id: t.id };
  },

  'projects.removeTask': (_u, { id }: { id: string }) => {
    run('DELETE FROM proj_tasks WHERE id = ?', id);
  },

  /** Ask the local model to break a goal into tasks, and add them to the project. */
  'projects.aiPlan': async (u, { project_id, goal }: { project_id: string; goal: string }) => {
    need(goal?.trim(), 'Describe what you want to get done.');
    need(get('SELECT 1 FROM proj_projects WHERE id = ?', project_id), 'Choose a project first.');
    const out = await ai([
      { role: 'system', content: 'Break the goal into 4 to 8 concrete tasks a small company can act on. Output only the tasks, one per line, each starting with "- ", each under 12 words. No headings, no commentary.' },
      { role: 'user', content: goal.slice(0, 2000) },
    ], { maxTokens: 400 });
    const titles = out.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*+/g, '').trim()).filter((l) => l.length > 2).slice(0, 10);
    need(titles.length, 'The assistant did not return any tasks. Try again.');
    for (const title of titles) addTask(u.id, { project_id, title });
    return { added: titles.length };
  },
};
