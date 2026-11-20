// The app catalog: plain data shared by the CLI installer, the server and the web shell.
// status: 'available' = built and installable, 'planned' = on the roadmap.
// group: the sidebar section the app sits in.
export const GROUPS = ['Communicate', 'Create', 'Customers', 'Money', 'Automate'];

export const CATALOG = [
  { id: 'mail', group: 'Communicate', name: 'Mail', replaces: 'Gmail, Outlook', description: 'Company email. The assistant can summarise threads and draft replies for you.', action: 'Write an email', status: 'available' },
  { id: 'calendar', group: 'Communicate', name: 'Calendar', replaces: 'Outlook Calendar, Calendly', description: 'Your meetings, shared with the team. Invitations go out by email.', action: 'New event', status: 'available' },
  { id: 'meet', group: 'Communicate', name: 'Meet', replaces: 'Zoom, Teams', description: 'Video calls in the browser, hosted on your own machine.', action: 'Start a call', status: 'available' },
  { id: 'chat', group: 'Communicate', name: 'Chat', replaces: 'Slack, Teams chat', description: 'Quick messages with your team, grouped by topic.', action: 'New message', status: 'available' },
  { id: 'docs', group: 'Create', name: 'Docs', replaces: 'Microsoft Word, Google Docs', description: 'Write documents. Opens and saves Word files.', action: 'New document', status: 'available' },
  { id: 'sheets', group: 'Create', name: 'Sheets', replaces: 'Excel, Google Sheets', description: 'Spreadsheets with 80 formulas and charts. Opens and saves Excel files.', action: 'New spreadsheet', status: 'available' },
  { id: 'slides', group: 'Create', name: 'Slides', replaces: 'PowerPoint, Keynote', description: 'Presentations. Opens and saves PowerPoint files.', action: 'New presentation', status: 'available' },
  { id: 'drive', group: 'Create', name: 'Drive', replaces: 'Dropbox, Google Drive', description: 'All your files, stored on your own machine.', action: 'Upload files', status: 'available' },
  { id: 'crm', group: 'Customers', name: 'CRM', replaces: 'HubSpot, Pipedrive', description: 'Track every possible sale from first contact to won.', action: 'Add a deal', status: 'available' },
  { id: 'contacts', group: 'Customers', name: 'Contacts', replaces: 'Outlook People', description: 'Your team and everyone you deal with.', action: 'Add a contact', status: 'available' },
  { id: 'projects', group: 'Customers', name: 'Projects', replaces: 'Trello, Asana', description: 'Tasks for you and your team, on a simple board.', action: 'Add a task', status: 'available' },
  { id: 'linkedin', group: 'Customers', name: 'LinkedIn', replaces: 'Buffer, Sales Navigator lists, outreach spreadsheets', description: 'Posts, leads and campaigns for LinkedIn. The agent drafts; you stay in control of what goes out.', action: 'New post', status: 'available' },
  { id: 'sign', group: 'Customers', name: 'Sign', replaces: 'DocuSign', description: 'Send a PDF for signature with a private link.', action: 'Send for signature', status: 'available' },
  { id: 'accounting', group: 'Money', name: 'Accounting', replaces: 'QuickBooks, Xero', description: 'Invoices, quotes and expenses, with payment reminders.', action: 'New invoice', status: 'available' },
  { id: 'factories', group: 'Automate', name: 'Value Factories', replaces: 'agencies, freelancers, Zapier-style busywork', description: 'Projects run by agents: campaigns, sales funnels, outreach, branding, apps and automations. Give each task to an agent and approve what goes out.', action: 'New factory', status: 'available' },
  { id: 'agents', group: 'Automate', name: 'Agents', replaces: 'custom GPTs, agent builders', description: 'Build your own AI agents: a role, tools, MCP servers, skills, memory and context, on the local model or any API.', action: 'Build an agent', status: 'available' },
  { id: 'tax', group: 'Money', name: 'Tax', replaces: 'manual VAT spreadsheets', description: 'VAT and GST figures for each quarter, worked out from your invoices.', action: 'Review this quarter', status: 'available' },
];

// Subscriptions people often pay for, and what replaces them. Used by setup and Settings to show savings.
// Prices are typical single-seat monthly list prices in US dollars, as a rough guide only.
export const TOOLS = [
  { id: 'gw', name: 'Google Workspace', apps: ['mail', 'calendar', 'docs'], price: 14 },
  { id: 'ms', name: 'Microsoft 365', apps: ['docs', 'sheets', 'slides'], price: 13 },
  { id: 'slack', name: 'Slack', apps: ['chat'], price: 9 },
  { id: 'zoom', name: 'Zoom', apps: ['meet'], price: 16 },
  { id: 'dropbox', name: 'Dropbox', apps: ['drive'], price: 12 },
  { id: 'hubspot', name: 'HubSpot', apps: ['crm'], price: 20 },
  { id: 'qb', name: 'QuickBooks', apps: ['accounting'], price: 35 },
  { id: 'trello', name: 'Trello', apps: ['projects'], price: 6 },
  { id: 'docusign', name: 'DocuSign', apps: ['sign'], price: 15 },
  { id: 'calendly', name: 'Calendly', apps: ['calendar'], price: 10 },
];

// One-click shortcuts for the home screen.
export const JOBS = [
  { id: 'invoice', label: 'Send an invoice', app: 'accounting' },
  { id: 'email', label: 'Email a customer', app: 'mail' },
  { id: 'meeting', label: 'Book a meeting', app: 'calendar' },
  { id: 'doc', label: 'Write a document', app: 'docs' },
  { id: 'deal', label: 'Add a customer', app: 'crm' },
  { id: 'task', label: 'Plan a project', app: 'projects' },
  { id: 'sign', label: 'Get something signed', app: 'sign' },
];
