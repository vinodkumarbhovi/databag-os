import crypto from 'node:crypto';
import { type Done, type Pending, ask, decide } from '../agent/agent.ts';
import type { User } from '../auth.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { type Handlers, need } from '../rpc.ts';
import { agentFromTemplate } from './agents.ts';

/**
 * Value Factories: a project with a goal, a to-do list, and agents that do the work.
 * Each task can be given to an agent. Running it hands the agent the goal, the task
 * and what earlier tasks produced; anything that reaches other people waits for
 * approval on the task card. Factories are projects, so they also show in Projects.
 */
type T = { title: string; notes?: string };
export const FACTORY_TEMPLATES: { id: string; name: string; agent: string; description: string; goal: string; tasks: T[] }[] = [
  { id: 'campaign', name: 'Campaign', agent: 'campaign', description: 'Plan and run a campaign: brief, posts, leads, follow-up.',
    goal: 'Run a two-week campaign that brings in qualified conversations.',
    tasks: [
      { title: 'Write the campaign brief', notes: 'Audience, problem, offer, message and how we measure it. Save it in Docs.' },
      { title: 'Set up the LinkedIn campaign with 3 draft posts', notes: 'Drafts only, for review.' },
      { title: 'Pick the 10 best-fitting leads', notes: 'From the LinkedIn leads and CRM contacts; explain why each fits.' },
      { title: 'Write personal first messages for the top leads' },
      { title: 'Put a campaign review in the calendar for next Friday', notes: 'Personal reminder, no attendees.' },
    ] },
  { id: 'sales-funnel', name: 'Sales funnel', agent: 'sales', description: 'Move leads through the funnel to won deals.',
    goal: 'Turn current leads into a clean pipeline and move the warmest deals forward this week.',
    tasks: [
      { title: 'Review the pipeline and list the 5 warmest deals', notes: 'Say what the next step is for each.' },
      { title: 'Move good LinkedIn leads into the CRM' },
      { title: 'Draft follow-up emails for deals waiting on us' },
      { title: 'Prepare a quote for the most advanced deal', notes: 'Only if the deal has a value and a contact.' },
      { title: 'Write a one-page funnel summary', notes: 'Stages, counts, value, blockers. Save in Docs.' },
    ] },
  { id: 'marketing', name: 'Marketing', agent: 'marketing', description: 'Positioning, content plan and the first pieces of content.',
    goal: 'Make clear what we sell and to whom, and publish a month of content.',
    tasks: [
      { title: 'Write the positioning brief' },
      { title: 'Plan a month of content', notes: 'Four weekly themes, one post idea per week. Save in Docs.' },
      { title: 'Draft the first two LinkedIn posts' },
    ] },
  { id: 'outreach', name: 'Outreach', agent: 'outreach', description: 'Find the right people and start conversations.',
    goal: 'Start 10 good conversations with people who fit our customer profile.',
    tasks: [
      { title: 'Describe our ideal customer in five lines' },
      { title: 'Pick the 10 best-fitting people from leads and contacts' },
      { title: 'Write a personal first message for each' },
    ] },
  { id: 'branding', name: 'Branding', agent: 'brand', description: 'Voice, messaging and simple brand guidelines.',
    goal: 'Write down how the company sounds and looks so everyone stays consistent.',
    tasks: [
      { title: 'Write the tone-of-voice guide', notes: 'Do and don\'t examples.' },
      { title: 'Write the key messages', notes: 'One-liner, short paragraph, three proof points.' },
      { title: 'Make a short brand presentation', notes: 'Five slides.' },
    ] },
  { id: 'new-project', name: 'New project', agent: 'operations', description: 'Kick off any new project with a plan and owners.',
    goal: 'Get a new project from idea to a clear plan with owners and dates.',
    tasks: [
      { title: 'Write a one-page project charter', notes: 'Why, what, who, when, risks.' },
      { title: 'Break the work into tasks with due dates' },
      { title: 'Book a kickoff reminder for Monday morning', notes: 'Personal reminder, no attendees.' },
    ] },
  { id: 'build-app', name: 'Build an app', agent: 'builder', description: 'Spec and plan a software or low-code application.',
    goal: 'Specify a small internal application and plan how to build it.',
    tasks: [
      { title: 'Write the spec: users, screens, data and rules' },
      { title: 'Decide: low-code (sheets and docs) or real code, and why' },
      { title: 'Make the data sheet for the first version', notes: 'One spreadsheet with the main table and example rows.' },
      { title: 'Turn the spec into build tasks' },
    ] },
  { id: 'automation', name: 'Process automation', agent: 'automation', description: 'Map a process and automate the repetitive steps.',
    goal: 'Take one repetitive process and make it run with as little manual work as possible.',
    tasks: [
      { title: 'Map the process step by step', notes: 'Who does what, when, with which tool. Save in Docs.' },
      { title: 'Mark which steps can be automated with databag' },
      { title: 'Set up the automations that are possible now' },
      { title: 'Write the checklist for the steps that stay manual' },
    ] },
  { id: 'custom', name: 'Blank factory', agent: '', description: 'Start empty: write a goal, plan tasks, assign agents.', goal: '', tasks: [] },
];

type Factory = { id: string; name: string; description: string; goal: string; template: string };
type Task = { id: string; project_id: string; title: string; notes: string; status: string; agent_id: string | null; agent_state: string; agent_output: string;
  agent_conversation: string | null; agent_pending: string | null; agent_log: string; agent_ran_at: number | null };

const factory = (id: string) => { const f = get<Factory>("SELECT id, name, description, goal, template FROM proj_projects WHERE id = ? AND kind = 'factory'", id); need(f, 'That factory does not exist.'); return f; };
const task = (id: string) => { const t = get<Task>('SELECT * FROM proj_tasks WHERE id = ?', id); need(t, 'That task does not exist.'); return t; };

/** Store what came back from the agent on the task. */
function record(t: Task, turn: { conversation: string; reply: string; done: Done[]; pending: Pending | null; incomplete?: boolean; declined?: boolean }) {
  const log = [...JSON.parse(t.agent_log || '[]'), ...turn.done].slice(-40);
  if (turn.pending) {
    run("UPDATE proj_tasks SET agent_state = 'waiting', agent_conversation = ?, agent_pending = ?, agent_log = ?, updated_at = ? WHERE id = ?", turn.conversation, JSON.stringify(turn.pending), JSON.stringify(log), Date.now(), t.id);
    return;
  }
  // Finished work waits for a person to accept it; the task is only marked done then.
  run('UPDATE proj_tasks SET agent_state = ?, agent_output = ?, agent_conversation = ?, agent_pending = NULL, agent_log = ?, updated_at = ? WHERE id = ?',
    turn.incomplete || turn.declined ? 'failed' : 'review', turn.reply.slice(0, 20000), turn.conversation, JSON.stringify(log), Date.now(), t.id);
}

async function runTask(u: User, t: Task) {
  need(t.agent_id, 'Give this task to an agent first.');
  need(t.agent_state !== 'running' || (t.agent_ran_at ?? 0) < Date.now() - 600_000, 'An agent is already working on this task.');
  const f = factory(t.project_id);
  const earlier = all<{ title: string; agent_output: string }>("SELECT title, agent_output FROM proj_tasks WHERE project_id = ? AND id != ? AND (status = 'done' OR agent_state = 'review') ORDER BY position", f.id, t.id);
  const message = [
    `You are working in the Value Factory "${f.name}".${f.goal ? ` Its goal: ${f.goal}` : ''}`,
    earlier.length ? `Tasks already finished, with what they produced:\n${earlier.map((e) => `- ${e.title}: ${(e.agent_output || 'done by a person').slice(0, 600)}`).join('\n')}` : '',
    `Your task now: ${t.title}`,
    t.notes ? `Notes: ${t.notes}` : '',
    'Do this task now with your tools. When it is finished, reply with the result.',
  ].filter(Boolean).join('\n\n');
  run("UPDATE proj_tasks SET agent_state = 'running', status = 'doing', agent_pending = NULL, agent_ran_at = ?, updated_at = ? WHERE id = ?", Date.now(), Date.now(), t.id);
  try {
    const turn = await ask(u, { message, app: 'projects', agent: t.agent_id });
    record(t, turn);
    if (!turn.pending) emit({ type: 'factories.task.done', app: 'projects', userId: u.id, summary: `An agent finished "${t.title}": ready for your review`, payload: { taskId: t.id } });
    return turn;
  } catch (err) {
    run("UPDATE proj_tasks SET agent_state = 'failed', agent_output = ?, updated_at = ? WHERE id = ?", (err as Error).message, Date.now(), t.id);
    throw err;
  }
}

export const factories: Handlers = {
  'factories.list': () => ({
    factories: all(`SELECT p.id, p.name, p.description, p.goal, p.template, COUNT(t.id) AS total, COALESCE(SUM(t.status = 'done'), 0) AS done,
      COALESCE(SUM(t.agent_state = 'waiting'), 0) AS waiting FROM proj_projects p LEFT JOIN proj_tasks t ON t.project_id = p.id
      WHERE p.kind = 'factory' GROUP BY p.id ORDER BY p.created_at DESC`),
    templates: FACTORY_TEMPLATES.map(({ id, name, description, goal }) => ({ id, name, description, goal })),
    agents: all('SELECT id, name, description FROM agents ORDER BY name'),
  }),

  /** A new factory from a template: its tasks, and its agent (made from the agent template if needed). */
  'factories.create': (u, { template, name, goal }: { template: string; name?: string; goal?: string }) => {
    const tpl = FACTORY_TEMPLATES.find((x) => x.id === template);
    need(tpl, 'Choose a kind of factory.');
    const title = (name?.trim() || tpl.name).slice(0, 120);
    const id = crypto.randomUUID();
    const now = Date.now();
    run("INSERT INTO proj_projects (id, name, description, goal, template, kind, created_at) VALUES (?, ?, ?, ?, ?, 'factory', ?)", id, title, tpl.description, (goal?.trim() || tpl.goal).slice(0, 2000), tpl.id, now);
    const agentId = tpl.agent ? agentFromTemplate(u.id, tpl.agent) : null;
    tpl.tasks.forEach((t, i) => run('INSERT INTO proj_tasks (id, project_id, title, notes, agent_id, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), id, t.title, t.notes ?? '', agentId, now + i, u.id, now, now));
    emit({ type: 'factories.created', app: 'projects', userId: u.id, summary: `You started the value factory "${title}"`, payload: { projectId: id } });
    return { id };
  },

  'factories.save': (_u, { id, name, goal }: { id: string; name: string; goal: string }) => {
    factory(id);
    need(name?.trim(), 'Give the factory a name.');
    run('UPDATE proj_projects SET name = ?, goal = ? WHERE id = ?', name.trim().slice(0, 120), (goal ?? '').slice(0, 2000), id);
  },

  'factories.tasks': (_u, { id }: { id: string }) =>
    all<Task & { agent: string | null }>('SELECT t.*, a.name AS agent FROM proj_tasks t LEFT JOIN agents a ON a.id = t.agent_id WHERE t.project_id = ? ORDER BY t.position', id)
      .map((t) => ({ id: t.id, title: t.title, notes: t.notes, status: t.status, agent_id: t.agent_id, agent: t.agent, state: t.agent_state, output: t.agent_output,
        pending: t.agent_pending ? JSON.parse(t.agent_pending) as Pending : null, log: JSON.parse(t.agent_log || '[]') as Done[] })),

  'factories.addTask': (u, { id, title, notes, agent_id }: { id: string; title: string; notes?: string; agent_id?: string }) => {
    factory(id);
    need(title?.trim(), 'What needs doing?');
    const now = Date.now();
    run('INSERT INTO proj_tasks (id, project_id, title, notes, agent_id, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), id, title.trim().slice(0, 300), notes ?? '', agent_id || null, now, u.id, now, now);
  },

  'factories.updateTask': (_u, { id, title, notes, agent_id }: { id: string; title?: string; notes?: string; agent_id?: string | null }) => {
    const t = task(id);
    need(t.agent_state !== 'running', 'An agent is working on this task. Wait for it to finish.');
    run('UPDATE proj_tasks SET title = ?, notes = ?, agent_id = ?, updated_at = ? WHERE id = ?', title?.trim() || t.title, notes ?? t.notes, agent_id === undefined ? t.agent_id : agent_id || null, Date.now(), id);
  },

  /** Clear the agent's result so the task can be run again. */
  'factories.resetTask': (_u, { id }: { id: string }) => {
    run("UPDATE proj_tasks SET status = 'todo', agent_state = '', agent_output = '', agent_pending = NULL, agent_conversation = NULL, agent_log = '[]' WHERE id = ?", id);
  },

  'factories.run': async (u, { id }: { id: string }) => {
    const turn = await runTask(u, task(id));
    return { state: turn.pending ? 'waiting' : turn.incomplete ? 'failed' : 'review' };
  },

  /** A person accepts the agent's work: the task is done. */
  'factories.accept': (_u, { id }: { id: string }) => {
    task(id);
    run("UPDATE proj_tasks SET status = 'done', agent_state = 'done', updated_at = ? WHERE id = ?", Date.now(), id);
  },

  /** Approve or decline the action the agent is waiting on (the text can be edited first). */
  'factories.decide': async (u, { id, approve, edits }: { id: string; approve: boolean; edits?: Record<string, string> }) => {
    const t = task(id);
    const pending = t.agent_pending ? JSON.parse(t.agent_pending) as Pending : null;
    need(pending && t.agent_conversation, 'Nothing is waiting for approval on this task.');
    run("UPDATE proj_tasks SET agent_state = 'running', agent_ran_at = ? WHERE id = ?", Date.now(), id);
    try {
      const turn = await decide(u, { conversation: t.agent_conversation!, pending: pending.id, approve, edits });
      record(t, turn);
      return { state: turn.pending ? 'waiting' : turn.incomplete || turn.declined ? 'failed' : 'review' };
    } catch (err) {
      run("UPDATE proj_tasks SET agent_state = 'failed', agent_output = ?, agent_pending = NULL WHERE id = ?", (err as Error).message, id);
      throw err;
    }
  },
};
