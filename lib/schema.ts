/**
 * Every module's database schema, as append-only steps. All apps live in one
 * SQLite file, which is what lets them read each other's data cheaply.
 */
export const SCHEMA: { module: string; steps: string[] }[] = [
  {
    module: 'core',
    steps: [
      `CREATE TABLE users (
         id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
         password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at INTEGER NOT NULL);
       CREATE TABLE sessions (
         token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
       CREATE TABLE events (
         id TEXT PRIMARY KEY, type TEXT NOT NULL, app TEXT NOT NULL, user_id TEXT, summary TEXT NOT NULL,
         payload TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
       CREATE INDEX events_user ON events(user_id, created_at DESC);`,
    ],
  },
  {
    // Shared state that must work when several servers answer requests (the cloud):
    // settings, stored files, agent conversations, live call signalling and who is editing what.
    module: 'platform',
    steps: [
      `CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       CREATE TABLE blob_chunks (key TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (key, idx));
       CREATE TABLE agent_conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
       CREATE TABLE meet_peers (peer_id TEXT PRIMARY KEY, room TEXT NOT NULL, name TEXT NOT NULL, seen INTEGER NOT NULL);
       CREATE INDEX meet_peers_room ON meet_peers(room);
       CREATE TABLE meet_signals (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, to_peer TEXT NOT NULL, from_peer TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
       CREATE INDEX meet_signals_to ON meet_signals(to_peer);
       CREATE TABLE office_presence (file_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, seen INTEGER NOT NULL, PRIMARY KEY (file_id, user_id));`,
    ],
  },
  {
    module: 'mail',
    steps: [
      `CREATE TABLE mail_messages (
         id TEXT PRIMARY KEY,
         owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         folder TEXT NOT NULL,
         thread_id TEXT NOT NULL,
         message_id TEXT NOT NULL,
         in_reply_to TEXT,
         from_addr TEXT NOT NULL,
         from_name TEXT NOT NULL DEFAULT '',
         to_addrs TEXT NOT NULL DEFAULT '[]',
         cc_addrs TEXT NOT NULL DEFAULT '[]',
         subject TEXT NOT NULL DEFAULT '',
         body_text TEXT NOT NULL DEFAULT '',
         body_html TEXT,
         snippet TEXT NOT NULL DEFAULT '',
         is_read INTEGER NOT NULL DEFAULT 0,
         is_starred INTEGER NOT NULL DEFAULT 0,
         delivery TEXT,
         ai_summary TEXT,
         created_at INTEGER NOT NULL);
       CREATE INDEX mail_owner_folder ON mail_messages(owner_id, folder, created_at DESC);
       CREATE INDEX mail_thread ON mail_messages(owner_id, thread_id);
       CREATE INDEX mail_msgid ON mail_messages(owner_id, message_id);`,
    ],
  },
  {
    module: 'calendar',
    steps: [
      `CREATE TABLE cal_events (
         id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
         location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', attendees TEXT NOT NULL DEFAULT '[]',
         meet_room TEXT, created_at INTEGER NOT NULL);
       CREATE INDEX cal_time ON cal_events(starts_at);`,
    ],
  },
  {
    module: 'chat',
    steps: [
      `CREATE TABLE chat_channels (
         id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'channel', members TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL);
       CREATE TABLE chat_messages (
         id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
       CREATE INDEX chat_chan ON chat_messages(channel_id, created_at);`,
    ],
  },
  {
    module: 'meet',
    steps: [
      `CREATE TABLE meet_rooms (
         id TEXT PRIMARY KEY, title TEXT NOT NULL, host_id TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', summary TEXT, created_at INTEGER NOT NULL);`,
    ],
  },
  {
    module: 'office',
    steps: [
      `CREATE TABLE office_files (
         id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
         updated_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
       CREATE INDEX office_kind ON office_files(kind, updated_at DESC);`,
      // Co-editing: a revision counter to detect clashes, saved versions, and comments.
      `ALTER TABLE office_files ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
       ALTER TABLE office_files ADD COLUMN updated_by TEXT;
       CREATE TABLE office_versions (
         id TEXT PRIMARY KEY, file_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
       CREATE INDEX office_versions_file ON office_versions(file_id, created_at DESC);
       CREATE TABLE office_comments (
         id TEXT PRIMARY KEY, file_id TEXT NOT NULL, user_id TEXT NOT NULL, quote TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
         resolved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
       CREATE INDEX office_comments_file ON office_comments(file_id, created_at);`,
    ],
  },
  {
    module: 'drive',
    steps: [
      `CREATE TABLE drive_files (
         id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);`,
    ],
  },
  {
    module: 'crm',
    steps: [
      `CREATE TABLE crm_contacts (
         id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '',
         phone TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
       CREATE TABLE crm_deals (
         id TEXT PRIMARY KEY, contact_id TEXT, title TEXT NOT NULL, value REAL NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'lead',
         created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`,
    ],
  },
  {
    module: 'accounting',
    steps: [
      `CREATE TABLE acc_invoices (
         id TEXT PRIMARY KEY, number TEXT NOT NULL, contact_id TEXT, customer_name TEXT NOT NULL, customer_email TEXT NOT NULL DEFAULT '',
         items TEXT NOT NULL DEFAULT '[]', vat_rate REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
         issued_at INTEGER NOT NULL, due_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
       CREATE TABLE acc_expenses (
         id TEXT PRIMARY KEY, vendor TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Other',
         amount REAL NOT NULL, vat REAL NOT NULL DEFAULT 0, spent_at INTEGER NOT NULL, created_at INTEGER NOT NULL);`,
      `ALTER TABLE acc_invoices ADD COLUMN kind TEXT NOT NULL DEFAULT 'invoice';
       ALTER TABLE acc_invoices ADD COLUMN reminded_at INTEGER;`,
      `ALTER TABLE acc_invoices ADD COLUMN paid_at INTEGER;
       ALTER TABLE acc_invoices ADD COLUMN recurring_id TEXT;
       UPDATE acc_invoices SET paid_at = issued_at WHERE status = 'paid';
       CREATE TABLE acc_recurring (
         id TEXT PRIMARY KEY, contact_id TEXT, customer_name TEXT NOT NULL, customer_email TEXT NOT NULL DEFAULT '',
         items TEXT NOT NULL, vat_rate REAL NOT NULL DEFAULT 0, every TEXT NOT NULL, due_days INTEGER NOT NULL DEFAULT 14,
         next_at INTEGER NOT NULL, auto_send INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
         created_by TEXT NOT NULL, created_at INTEGER NOT NULL, last_at INTEGER);
       CREATE TABLE acc_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       CREATE TABLE acc_journal (
         id TEXT PRIMARY KEY, date INTEGER NOT NULL, memo TEXT NOT NULL, lines TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
       CREATE TABLE acc_bank_lines (
         id TEXT PRIMARY KEY, date INTEGER NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, fingerprint TEXT NOT NULL UNIQUE,
         match_kind TEXT, match_id TEXT, ignored INTEGER NOT NULL DEFAULT 0, imported_at INTEGER NOT NULL);
       ALTER TABLE acc_expenses ADD COLUMN bank_line_id TEXT;`,
    ],
  },
  {
    module: 'booking',
    steps: [
      `CREATE TABLE cal_booking_pages (
         id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
         minutes INTEGER NOT NULL, days TEXT NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, buffer_min INTEGER NOT NULL DEFAULT 0,
         notice_hours INTEGER NOT NULL DEFAULT 4, ahead_days INTEGER NOT NULL DEFAULT 30, add_meet INTEGER NOT NULL DEFAULT 1,
         active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
       ALTER TABLE cal_events ADD COLUMN booked_by TEXT;`,
    ],
  },
  {
    module: 'linkedin',
    steps: [
      `CREATE TABLE li_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       CREATE TABLE li_campaigns (
         id TEXT PRIMARY KEY, name TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '', offer TEXT NOT NULL DEFAULT '',
         status TEXT NOT NULL DEFAULT 'active', created_by TEXT NOT NULL, created_at INTEGER NOT NULL);
       CREATE TABLE li_posts (
         id TEXT PRIMARY KEY, campaign_id TEXT, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', scheduled_at INTEGER, published_at INTEGER,
         post_urn TEXT, error TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
       CREATE TABLE li_leads (
         id TEXT PRIMARY KEY, name TEXT NOT NULL, headline TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '', profile_url TEXT NOT NULL DEFAULT '',
         email TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', campaign_id TEXT, score INTEGER, score_reason TEXT NOT NULL DEFAULT '',
         message TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', contact_id TEXT, source TEXT NOT NULL DEFAULT 'manual',
         last_touch_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
       CREATE UNIQUE INDEX li_leads_url ON li_leads(profile_url) WHERE profile_url != '';`,
    ],
  },
  {
    module: 'projects',
    steps: [
      `CREATE TABLE proj_projects (
         id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
       CREATE TABLE proj_tasks (
         id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo',
         assignee_id TEXT, due_at INTEGER, position REAL NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
       CREATE INDEX proj_tasks_project ON proj_tasks(project_id, position);`,
      // Value Factories: a project with a goal whose tasks can be handed to agents.
      `ALTER TABLE proj_projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'project';
       ALTER TABLE proj_projects ADD COLUMN template TEXT NOT NULL DEFAULT '';
       ALTER TABLE proj_projects ADD COLUMN goal TEXT NOT NULL DEFAULT '';
       ALTER TABLE proj_tasks ADD COLUMN agent_id TEXT;
       ALTER TABLE proj_tasks ADD COLUMN agent_state TEXT NOT NULL DEFAULT '';
       ALTER TABLE proj_tasks ADD COLUMN agent_output TEXT NOT NULL DEFAULT '';
       ALTER TABLE proj_tasks ADD COLUMN agent_conversation TEXT;
       ALTER TABLE proj_tasks ADD COLUMN agent_pending TEXT;
       ALTER TABLE proj_tasks ADD COLUMN agent_log TEXT NOT NULL DEFAULT '[]';
       ALTER TABLE proj_tasks ADD COLUMN agent_ran_at INTEGER;`,
    ],
  },
  {
    module: 'tax',
    steps: [`CREATE TABLE tax_returns (period TEXT PRIMARY KEY, filed_at INTEGER NOT NULL, filed_by TEXT NOT NULL, figures TEXT NOT NULL);`],
  },
  {
    module: 'sign',
    steps: [
      `CREATE TABLE sign_docs (
         id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
         status TEXT NOT NULL DEFAULT 'draft', created_at INTEGER NOT NULL, completed_at INTEGER);
       CREATE TABLE sign_signers (
         id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
         signed_name TEXT, signed_at INTEGER, ip TEXT, created_at INTEGER NOT NULL);`,
    ],
  },
  {
    // Agents people build: a role, tools, MCP servers, skills, memory and context.
    module: 'agents',
    steps: [
      `CREATE TABLE agents (
         id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '',
         tools TEXT NOT NULL DEFAULT '[]', mcps TEXT NOT NULL DEFAULT '[]', skills TEXT NOT NULL DEFAULT '[]',
         memory INTEGER NOT NULL DEFAULT 1, context TEXT NOT NULL DEFAULT '', ai TEXT NOT NULL DEFAULT '{}',
         template TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
       CREATE TABLE agent_memory (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, fact TEXT NOT NULL, created_at INTEGER NOT NULL);
       CREATE INDEX agent_memory_agent ON agent_memory(agent_id, created_at);`,
    ],
  },
  {
    // Everything agents do: each tool use, each approval asked for and given, each access request.
    module: 'activity',
    steps: [
      `CREATE TABLE agent_activity (
         id TEXT PRIMARY KEY, agent_id TEXT, agent_name TEXT NOT NULL, user_id TEXT NOT NULL, conversation TEXT,
         tool TEXT NOT NULL, app TEXT NOT NULL, risk TEXT NOT NULL, summary TEXT NOT NULL,
         status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', pending_id TEXT, link TEXT,
         decided_by TEXT, decided_at INTEGER, created_at INTEGER NOT NULL);
       CREATE INDEX agent_activity_time ON agent_activity(created_at DESC);
       CREATE INDEX agent_activity_pending ON agent_activity(pending_id);`,
    ],
  },
];
