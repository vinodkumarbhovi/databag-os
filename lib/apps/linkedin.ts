import crypto from 'node:crypto';
import { chat as ai } from '../ai.ts';
import { type User, listUsers } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { type Handlers, need } from '../rpc.ts';
import { publicUrl } from '../runtime.ts';
import { parseCsv } from './books.ts';
import { crm } from './crm.ts';

/**
 * LinkedIn for marketing and sales, within LinkedIn's rules:
 * - posts are published through LinkedIn's official API with the user's own connected account
 *   (or copied into LinkedIn by hand when no account is connected);
 * - leads come from the user's own LinkedIn data export, or are added by hand;
 * - private messages are written here but sent by the person themselves. LinkedIn forbids
 *   automated messaging and scraping, so databag never does either.
 */
type Post = { id: string; campaign_id: string | null; text: string; status: 'draft' | 'scheduled' | 'published' | 'failed'; scheduled_at: number | null; published_at: number | null; post_urn: string | null; error: string | null; created_by: string; created_at: number; updated_at: number };
type Lead = { id: string; name: string; headline: string; company: string; profile_url: string; email: string; status: string; campaign_id: string | null; score: number | null; score_reason: string; message: string; notes: string; contact_id: string | null; source: string; last_touch_at: number | null };
export const LEAD_STAGES = ['new', 'contacted', 'replied', 'meeting', 'won', 'not interested'];
const MAX_POST = 3000; // LinkedIn's limit for a post

const kv = (key: string) => get<{ value: string }>('SELECT value FROM li_kv WHERE key = ?', key)?.value;
const setKv = (key: string, value: string | null) => (value === null ? run('DELETE FROM li_kv WHERE key = ?', key) : run('INSERT INTO li_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value));
const bases = () => ({ api: loadConfig().linkedin?.apiBase ?? 'https://api.linkedin.com', auth: loadConfig().linkedin?.authBase ?? 'https://www.linkedin.com', version: loadConfig().linkedin?.version ?? '202510' });
export const origin = (req?: Request) => (process.env.DATABAG_URL || process.env.VERCEL || !req ? publicUrl('localhost', loadConfig().port) : new URL(req.url).origin);
const cleanUrl = (u: string) => { const m = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(u); return m ? `https://www.linkedin.com/in/${m[1].toLowerCase()}` : u.trim(); };

// ---------- Connecting a LinkedIn account (OAuth 2.0 with the user's own LinkedIn developer app) ----------
export function connection() {
  const exp = Number(kv('token_expires') ?? 0);
  return { appSet: !!kv('client_id'), clientId: kv('client_id') ?? '', connected: !!kv('token') && exp > Date.now(), name: kv('member_name') ?? '', expires: exp || null };
}
export function authUrl(req: Request): string {
  const clientId = kv('client_id');
  need(clientId && kv('client_secret'), 'Add your LinkedIn app’s client ID and secret first.');
  const state = crypto.randomBytes(16).toString('hex');
  setKv('oauth_state', `${state}:${Date.now()}`);
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: `${origin(req)}/api/linkedin/callback`, state, scope: 'openid profile w_member_social' });
  return `${bases().auth}/oauth/v2/authorization?${q}`;
}
export async function finishAuth(req: Request, code: string, state: string): Promise<void> {
  const [want, at] = (kv('oauth_state') ?? '').split(':');
  setKv('oauth_state', null);
  need(want && state === want && Date.now() - Number(at) < 15 * 60_000, 'That sign-in link expired. Try connecting again.');
  const res = await fetch(`${bases().auth}/oauth/v2/accessToken`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${origin(req)}/api/linkedin/callback`, client_id: kv('client_id')!, client_secret: kv('client_secret')! }),
  });
  const tok = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  need(res.ok && tok.access_token, `LinkedIn did not connect: ${tok.error_description ?? res.status}`);
  const me = (await (await fetch(`${bases().api}/v2/userinfo`, { headers: { authorization: `Bearer ${tok.access_token}` } })).json()) as { sub?: string; name?: string };
  need(me.sub, 'LinkedIn did not say which account this is.');
  setKv('token', tok.access_token!); setKv('token_expires', String(Date.now() + (tok.expires_in ?? 3600) * 1000));
  setKv('member', me.sub); setKv('member_name', me.name ?? '');
}

/** Publish one post on the connected member's profile. */
async function publish(text: string): Promise<string> {
  const c = connection();
  need(c.connected, 'No LinkedIn account is connected (or the connection expired). Connect it in LinkedIn → Settings, or copy the post into LinkedIn yourself.');
  const res = await fetch(`${bases().api}/rest/posts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${kv('token')}`, 'content-type': 'application/json', 'LinkedIn-Version': bases().version, 'X-Restli-Protocol-Version': '2.0.0' },
    body: JSON.stringify({ author: `urn:li:person:${kv('member')}`, commentary: text, visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false }),
  });
  need(res.status === 201 || res.ok, `LinkedIn refused the post (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.headers.get('x-restli-id') ?? res.headers.get('x-linkedin-id') ?? '';
}

async function publishPost(p: Post, userId: string): Promise<void> {
  try {
    const urn = await publish(p.text);
    run("UPDATE li_posts SET status = 'published', published_at = ?, post_urn = ?, error = NULL, updated_at = ? WHERE id = ?", Date.now(), urn, Date.now(), p.id);
    emit({ type: 'linkedin.published', app: 'linkedin', userId, summary: `Posted on LinkedIn: "${p.text.slice(0, 60)}…"`, payload: { postId: p.id } });
  } catch (err) {
    run("UPDATE li_posts SET status = 'failed', error = ?, updated_at = ? WHERE id = ?", (err as Error).message, Date.now(), p.id);
    throw err;
  }
}

/** Publish scheduled posts that are due. Runs every minute while databag is running. */
export async function runLinkedInJobs(now = Date.now()): Promise<number> {
  let n = 0;
  for (const p of all<Post>("SELECT * FROM li_posts WHERE status = 'scheduled' AND scheduled_at <= ?", now)) {
    try { await publishPost(p, p.created_by); n++; } catch { /* marked failed, shown in the app */ }
  }
  return n;
}
export function scheduleLinkedIn(): void {
  const store = globalThis as typeof globalThis & { __databagLiTimer?: ReturnType<typeof setInterval> };
  if (store.__databagLiTimer) return;
  store.__databagLiTimer = setInterval(() => { runLinkedInJobs().catch(() => {}); }, 60_000);
  store.__databagLiTimer.unref?.();
}

// ---------- Writing with the local model ----------
const companyLine = () => `The company is ${loadConfig().company.name}.`;
export async function draftPost(topic: string, campaign?: { goal: string; audience: string; offer: string }): Promise<string> {
  need(topic?.trim(), 'What should the post be about?');
  const out = await ai([
    { role: 'system', content: `You write LinkedIn posts for a small business owner. ${companyLine()} Write in the first person, warm and specific, 80 to 180 words. Start with a short hook line. Short paragraphs separated by blank lines. End with one question or a clear call to action. At most 3 relevant hashtags on the last line. No markdown, no emojis in every line. Never invent customers, stories, events, numbers or results: this is published under a real name. If an example helps, make it clearly hypothetical (\"Imagine a café that…\") or speak from general experience.` },
    { role: 'user', content: [`Topic: ${topic}`, campaign?.goal && `Campaign goal: ${campaign.goal}`, campaign?.audience && `Audience: ${campaign.audience}`, campaign?.offer && `Offer: ${campaign.offer}`].filter(Boolean).join('\n') },
  ], { maxTokens: 500, temperature: 0.7 });
  return out.replace(/\*\*/g, '').trim().slice(0, MAX_POST);
}
async function writeMessage(lead: Lead, u: User, campaign?: { goal: string; offer: string }): Promise<string> {
  const out = await ai([
    { role: 'system', content: `Write a short personal LinkedIn message (under 80 words) from ${u.name} of ${loadConfig().company.name} to the person below. Friendly, specific to their role and company, no hard sell, one soft question at the end. No subject line, no placeholders, no markdown. Sign with ${u.name.split(' ')[0]}.` },
    { role: 'user', content: [`Name: ${lead.name}`, lead.headline && `Role: ${lead.headline}`, lead.company && `Company: ${lead.company}`, lead.notes && `Notes: ${lead.notes}`, campaign?.goal && `Reason to reach out: ${campaign.goal}`, campaign?.offer && `What we offer: ${campaign.offer}`].filter(Boolean).join('\n') },
  ], { maxTokens: 220, temperature: 0.6 });
  return out.replace(/\*\*/g, '').trim();
}
/** Score how well leads match who the company wants to reach, 1–5, with one reason each. */
async function scoreLeads(leads: Lead[], audience: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < leads.length; i += 15) {
    const batch = leads.slice(i, i + 15);
    const out = await ai([
      { role: 'system', content: 'Rate how well each person fits the ideal customer, from 1 (poor) to 5 (excellent). Answer with one line per person exactly like: "<number>. <score> - <reason under 12 words>". Nothing else.' },
      { role: 'user', content: `Ideal customer: ${audience}\n\n${batch.map((l, j) => `${j + 1}. ${l.name}, ${l.headline || 'unknown role'}, ${l.company || 'unknown company'}`).join('\n')}` },
    ], { maxTokens: 60 * batch.length, temperature: 0.1 });
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)[.)]\s*([1-5])\s*[-–:]\s*(.+)$/.exec(line);
      const lead = m && batch[Number(m[1]) - 1];
      if (lead) { run('UPDATE li_leads SET score = ?, score_reason = ?, updated_at = ? WHERE id = ?', Number(m[2]), m[3].trim().slice(0, 120), Date.now(), lead.id); n++; }
    }
  }
  return n;
}

// ---------- Leads ----------
export function addLead(l: Partial<Lead>, source = 'manual'): { id: string; created: boolean } {
  need(l.name?.trim(), 'A lead needs a name.');
  const url = l.profile_url ? cleanUrl(l.profile_url) : '';
  const existing = url ? get<{ id: string }>('SELECT id FROM li_leads WHERE profile_url = ?', url) : undefined;
  if (existing) return { id: existing.id, created: false };
  const id = crypto.randomUUID();
  run('INSERT INTO li_leads (id, name, headline, company, profile_url, email, status, campaign_id, notes, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, l.name!.trim().slice(0, 120), (l.headline ?? '').slice(0, 200), (l.company ?? '').slice(0, 120), url, (l.email ?? '').trim().toLowerCase(), 'new', l.campaign_id || null, (l.notes ?? '').slice(0, 2000), source, Date.now(), Date.now());
  return { id, created: true };
}

/** LinkedIn's own data export ("Connections.csv"): First Name, Last Name, URL, Email Address, Company, Position, Connected On. */
export function importConnections(csv: string, campaignId?: string): { added: number; skipped: number } {
  const rows = parseCsv(csv);
  const at = rows.findIndex((r) => r.some((c) => /^first name$/i.test(c)));
  need(at >= 0, 'This does not look like LinkedIn’s Connections.csv (no "First Name" column). Download it from LinkedIn: Settings → Data privacy → Get a copy of your data → Connections.');
  const head = rows[at].map((c) => c.toLowerCase());
  const col = (n: string) => head.indexOf(n);
  let added = 0, skipped = 0;
  for (const r of rows.slice(at + 1)) {
    const name = `${r[col('first name')] ?? ''} ${r[col('last name')] ?? ''}`.trim();
    if (!name) { skipped++; continue; }
    const res = addLead({ name, profile_url: r[col('url')] ?? '', email: r[col('email address')] ?? '', company: r[col('company')] ?? '', headline: r[col('position')] ?? '', campaign_id: campaignId }, 'linkedin export');
    if (res.created) added++; else skipped++;
  }
  return { added, skipped };
}

const leadById = (id: string) => { const l = get<Lead>('SELECT * FROM li_leads WHERE id = ?', id); need(l, 'That lead does not exist.'); return l; };
const campaignById = (id?: string | null) => (id ? get<{ id: string; name: string; goal: string; audience: string; offer: string }>('SELECT * FROM li_campaigns WHERE id = ?', id) : undefined);

export const linkedin: Handlers = {
  'li.status': () => connection(),
  'li.saveApp': (u, { clientId, clientSecret }: { clientId: string; clientSecret?: string }) => {
    need(u.role === 'admin', 'Only an admin can connect LinkedIn.');
    need(clientId?.trim(), 'Enter the client ID from your LinkedIn app.');
    setKv('client_id', clientId.trim());
    if (clientSecret?.trim()) setKv('client_secret', clientSecret.trim());
    need(kv('client_secret'), 'Enter the client secret from your LinkedIn app.');
  },
  'li.disconnect': (u) => { need(u.role === 'admin', 'Only an admin can disconnect LinkedIn.'); for (const k of ['token', 'token_expires', 'member', 'member_name']) setKv(k, null); },

  // Posts
  'li.posts': () => all<Post & { campaign: string | null }>('SELECT p.*, c.name AS campaign FROM li_posts p LEFT JOIN li_campaigns c ON c.id = p.campaign_id ORDER BY COALESCE(p.published_at, p.scheduled_at, p.updated_at) DESC'),
  'li.draftPost': async (_u, { topic, campaignId }: { topic: string; campaignId?: string }) => ({ text: await draftPost(topic, campaignById(campaignId)) }),
  'li.savePost': (u, p: { id?: string; text: string; campaignId?: string | null; scheduledAt?: number | null }) => {
    const text = p.text?.trim();
    need(text, 'Write the post first.');
    need(text.length <= MAX_POST, `LinkedIn posts can be at most ${MAX_POST} characters.`);
    if (p.scheduledAt) need(p.scheduledAt > Date.now() - 60_000, 'Choose a time in the future.');
    const status = p.scheduledAt ? 'scheduled' : 'draft';
    if (p.id) {
      const old = get<Post>('SELECT * FROM li_posts WHERE id = ?', p.id);
      need(old && old.status !== 'published', 'Published posts cannot be changed here. Edit them on LinkedIn.');
      run('UPDATE li_posts SET text = ?, campaign_id = ?, status = ?, scheduled_at = ?, error = NULL, updated_at = ? WHERE id = ?', text, p.campaignId ?? old.campaign_id, status, p.scheduledAt ?? null, Date.now(), p.id);
      return { id: p.id, status };
    }
    const id = crypto.randomUUID();
    run('INSERT INTO li_posts (id, campaign_id, text, status, scheduled_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, p.campaignId || null, text, status, p.scheduledAt ?? null, u.id, Date.now(), Date.now());
    return { id, status };
  },
  'li.publishNow': async (u, { id }: { id: string }) => {
    const p = get<Post>('SELECT * FROM li_posts WHERE id = ?', id);
    need(p && p.status !== 'published', 'That post is already published.');
    await publishPost(p, u.id);
  },
  'li.markPosted': (u, { id }: { id: string }) => {
    run("UPDATE li_posts SET status = 'published', published_at = ?, error = NULL, updated_at = ? WHERE id = ?", Date.now(), Date.now(), id);
    emit({ type: 'linkedin.published', app: 'linkedin', userId: u.id, summary: 'You posted on LinkedIn', payload: { postId: id } });
  },
  'li.removePost': (_u, { id }: { id: string }) => { run("DELETE FROM li_posts WHERE id = ? AND status != 'published'", id); },

  // Leads
  'li.leads': (_u, { campaignId, status }: { campaignId?: string; status?: string }) =>
    all<Lead & { campaign: string | null }>(`SELECT l.*, c.name AS campaign FROM li_leads l LEFT JOIN li_campaigns c ON c.id = l.campaign_id WHERE 1 = 1 ${campaignId ? 'AND l.campaign_id = ?' : ''} ${status ? 'AND l.status = ?' : ''} ORDER BY COALESCE(l.score, 0) DESC, l.updated_at DESC LIMIT 1000`, ...[campaignId, status].filter(Boolean) as string[]),
  'li.saveLead': (_u, l: Partial<Lead>) => {
    if (!l.id) return addLead(l);
    const old = leadById(l.id);
    need(!l.status || LEAD_STAGES.includes(l.status), 'Unknown stage.');
    run('UPDATE li_leads SET name = ?, headline = ?, company = ?, profile_url = ?, email = ?, status = ?, campaign_id = ?, notes = ?, message = ?, last_touch_at = ?, updated_at = ? WHERE id = ?',
      l.name?.trim() || old.name, l.headline ?? old.headline, l.company ?? old.company, l.profile_url !== undefined ? cleanUrl(l.profile_url) : old.profile_url, (l.email ?? old.email).toLowerCase(), l.status ?? old.status,
      l.campaign_id !== undefined ? l.campaign_id || null : old.campaign_id, l.notes ?? old.notes, l.message ?? old.message, l.status && l.status !== old.status && l.status !== 'new' ? Date.now() : old.last_touch_at, Date.now(), l.id);
    return { id: l.id };
  },
  'li.removeLead': (_u, { id }: { id: string }) => { run('DELETE FROM li_leads WHERE id = ?', id); },
  'li.import': (u, { csv, campaignId }: { csv: string; campaignId?: string }) => {
    need(typeof csv === 'string' && csv.length < 10_000_000, 'That file is too large.');
    const r = importConnections(csv, campaignId);
    emit({ type: 'linkedin.imported', app: 'linkedin', userId: u.id, summary: `Imported ${r.added} LinkedIn connection${r.added === 1 ? '' : 's'} as leads`, payload: {} });
    return r;
  },
  'li.score': async (_u, { campaignId }: { campaignId?: string }) => {
    const c = campaignById(campaignId);
    const audience = c?.audience || kv('audience') || '';
    need(audience.trim(), 'Describe your ideal customer first (in a campaign, or under Leads).');
    const leads = all<Lead>(`SELECT * FROM li_leads WHERE status = 'new' ${c ? 'AND campaign_id = ?' : ''} ORDER BY created_at DESC LIMIT 150`, ...(c ? [c.id] : []));
    return { scored: await scoreLeads(leads, audience) };
  },
  'li.audience': () => ({ audience: kv('audience') ?? '' }),
  'li.saveAudience': (_u, { audience }: { audience: string }) => { setKv('audience', (audience ?? '').slice(0, 1000)); },
  'li.writeMessage': async (u, { id }: { id: string }) => {
    const lead = leadById(id);
    const message = await writeMessage(lead, u, campaignById(lead.campaign_id));
    run('UPDATE li_leads SET message = ?, updated_at = ? WHERE id = ?', message, Date.now(), id);
    return { message };
  },
  /** Make the lead a CRM contact with a deal, so sales can take it from there. */
  'li.toCrm': (u, { id, value }: { id: string; value?: number }) => {
    const lead = leadById(id);
    if (lead.contact_id && get('SELECT 1 FROM crm_contacts WHERE id = ?', lead.contact_id)) return { contactId: lead.contact_id };
    const { id: contactId } = crm['crm.saveContact'](u, { name: lead.name, email: lead.email, company: lead.company, notes: [lead.headline, lead.profile_url, lead.notes].filter(Boolean).join('\n') }) as { id: string };
    crm['crm.saveDeal'](u, { title: `${lead.company || lead.name} (LinkedIn)`, value: Number(value) || 0, contact_id: contactId });
    run("UPDATE li_leads SET contact_id = ?, status = CASE WHEN status IN ('new', 'contacted') THEN 'replied' ELSE status END, updated_at = ? WHERE id = ?", contactId, Date.now(), id);
    emit({ type: 'linkedin.toCrm', app: 'linkedin', userId: u.id, summary: `${lead.name} moved from LinkedIn leads to the CRM`, payload: { contactId } });
    return { contactId };
  },

  // Campaigns
  'li.campaigns': () => all<{ id: string; name: string; goal: string; audience: string; offer: string; status: string; created_at: number }>('SELECT * FROM li_campaigns ORDER BY created_at DESC').map((c) => ({
    ...c,
    posts: get<{ n: number; published: number; scheduled: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(status = 'published'), 0) AS published, COALESCE(SUM(status = 'scheduled'), 0) AS scheduled FROM li_posts WHERE campaign_id = ?", c.id),
    leads: Object.fromEntries(all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM li_leads WHERE campaign_id = ? GROUP BY status', c.id).map((r) => [r.status, r.n])),
  })),
  'li.saveCampaign': (u, c: { id?: string; name: string; goal?: string; audience?: string; offer?: string; status?: string }) => {
    need(c.name?.trim(), 'Give the campaign a name.');
    const v = [c.name.trim().slice(0, 120), (c.goal ?? '').slice(0, 1000), (c.audience ?? '').slice(0, 1000), (c.offer ?? '').slice(0, 1000), c.status === 'paused' ? 'paused' : 'active'];
    if (c.id) { run('UPDATE li_campaigns SET name = ?, goal = ?, audience = ?, offer = ?, status = ? WHERE id = ?', ...v, c.id); return { id: c.id }; }
    const id = crypto.randomUUID();
    run('INSERT INTO li_campaigns (name, goal, audience, offer, status, id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ...v, id, u.id, Date.now());
    return { id };
  },
  'li.removeCampaign': (_u, { id }: { id: string }) => {
    run('UPDATE li_leads SET campaign_id = NULL WHERE campaign_id = ?', id);
    run("DELETE FROM li_posts WHERE campaign_id = ? AND status != 'published'", id);
    run('UPDATE li_posts SET campaign_id = NULL WHERE campaign_id = ?', id);
    run('DELETE FROM li_campaigns WHERE id = ?', id);
  },
  /** Draft a series of posts for a campaign, one every few days, as scheduled posts to review. */
  'li.planPosts': async (u, { id, count, startAt, everyDays }: { id: string; count?: number; startAt?: number; everyDays?: number }) => {
    const c = campaignById(id);
    need(c, 'That campaign does not exist.');
    const n = Math.max(1, Math.min(8, Number(count) || 4));
    const topics = (await ai([
      { role: 'system', content: `List ${n} different LinkedIn post ideas for this campaign, one per line, each under 15 words. Mix: a story, a useful tip, a customer problem, a behind-the-scenes look, an offer. No numbering, no extra text. ${companyLine()}` },
      { role: 'user', content: `Goal: ${c.goal}\nAudience: ${c.audience}\nOffer: ${c.offer}` },
    ], { maxTokens: 300, temperature: 0.8 })).split('\n').map((t) => t.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((t) => t.length > 5).slice(0, n);
    need(topics.length, 'The assistant did not come up with post ideas. Try again.');
    const start = Number(startAt) || (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); })();
    const step = Math.max(1, Number(everyDays) || 3) * 864e5;
    let i = 0;
    for (const topic of topics) {
      const text = await draftPost(topic, c);
      linkedin['li.savePost'](u, { text, campaignId: c.id, scheduledAt: null });
      // Saved as drafts with a proposed time in the text of the schedule; the person schedules each after reading it.
      run('UPDATE li_posts SET scheduled_at = ? WHERE id = (SELECT id FROM li_posts WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1)', start + step * i++, c.id);
    }
    return { drafted: topics.length };
  },

  'li.summary': () => ({
    connection: connection(),
    posts: get('SELECT COUNT(*) AS total, COALESCE(SUM(status = \'scheduled\'), 0) AS scheduled, COALESCE(SUM(status = \'published\'), 0) AS published, COALESCE(SUM(status = \'draft\'), 0) AS drafts, COALESCE(SUM(status = \'failed\'), 0) AS failed FROM li_posts'),
    leads: Object.fromEntries(all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM li_leads GROUP BY status').map((r) => [r.status, r.n])),
    team: listUsers().length,
  }),
};
