'use client';

import { Copy, ExternalLink, Loader2, Mail, Plus, Send, Sparkles, Star, Trash2, Upload, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { param, rpc, when } from '@/lib/client';
import { Field, Modal, useToast } from './ui';

type Post = { id: string; campaign_id: string | null; campaign: string | null; text: string; status: string; scheduled_at: number | null; published_at: number | null; error: string | null };
type Lead = { id: string; name: string; headline: string; company: string; profile_url: string; email: string; status: string; campaign_id: string | null; campaign: string | null; score: number | null; score_reason: string; message: string; notes: string; contact_id: string | null };
type Campaign = { id: string; name: string; goal: string; audience: string; offer: string; status: string; posts: { n: number; published: number; scheduled: number }; leads: Record<string, number> };
type Status = { appSet: boolean; clientId: string; connected: boolean; name: string; expires: number | null };
const STAGES = ['new', 'contacted', 'replied', 'meeting', 'won', 'not interested'];
const MAX = 3000;
const local = (ts: number | null) => { if (!ts) return ''; const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const shareUrl = (text: string) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;

export function LinkedInApp() {
  const [tab, setTab] = useState<'posts' | 'leads' | 'campaigns' | 'settings'>(() => (param('tab') as 'settings') || 'posts');
  const [status, setStatus] = useState<Status | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const { toast, notify, attempt } = useToast();
  const loadBase = useCallback(() => {
    rpc<Status>('li.status').then(setStatus).catch(() => {});
    rpc<Campaign[]>('li.campaigns').then(setCampaigns).catch(() => {});
  }, []);
  useEffect(() => {
    loadBase();
    if (param('connected')) notify('LinkedIn is connected.');
    if (param('error')) notify(param('error')!);
  }, [loadBase, notify]);

  return (
    <div className="app">
      <div className="bar">
        <div className="tabs">
          {(['posts', 'leads', 'campaigns', 'settings'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} style={{ textTransform: 'capitalize' }}>{t}</button>)}
        </div>
        <span className="grow-gap" />
        {status && <span className={`badge ${status.connected ? 'good' : ''}`}>{status.connected ? `Connected as ${status.name || 'you'}` : 'Not connected: posts are copied into LinkedIn by hand'}</span>}
      </div>
      <div className="body">
        {tab === 'posts' && <Posts connected={!!status?.connected} campaigns={campaigns} notify={notify} attempt={attempt} />}
        {tab === 'leads' && <Leads campaigns={campaigns} notify={notify} attempt={attempt} />}
        {tab === 'campaigns' && <Campaigns campaigns={campaigns} reload={loadBase} attempt={attempt} notify={notify} />}
        {tab === 'settings' && status && <Connect status={status} reload={loadBase} attempt={attempt} />}
      </div>
      {toast}
    </div>
  );
}

type Shared = { notify: (t: string) => void; attempt: (a: () => Promise<unknown>, done?: string) => Promise<boolean> };

function Posts({ connected, campaigns, notify, attempt }: Shared & { connected: boolean; campaigns: Campaign[] }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [edit, setEdit] = useState<{ id?: string; text: string; campaignId: string; when: string; topic: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => rpc<Post[]>('li.posts').then(setPosts).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const draft = async () => {
    setBusy(true);
    await attempt(async () => { const { text } = await rpc<{ text: string }>('li.draftPost', { topic: edit!.topic, campaignId: edit!.campaignId || undefined }); setEdit((e) => e && { ...e, text }); });
    setBusy(false);
  };
  const save = async (schedule: boolean) => {
    const e = edit!;
    if (schedule && !e.when) return notify('Choose when to post it.');
    if (await attempt(() => rpc('li.savePost', { id: e.id, text: e.text, campaignId: e.campaignId || null, scheduledAt: schedule ? new Date(e.when).getTime() : null }), schedule ? 'Scheduled.' : 'Saved as a draft.')) { setEdit(null); load(); }
  };
  const copyOpen = async (p: { id?: string; text: string }) => {
    await navigator.clipboard.writeText(p.text).catch(() => {});
    window.open(shareUrl(p.text), '_blank', 'noopener');
    notify('The text is copied and LinkedIn is open. Once you have posted it, mark it as posted here.');
  };
  const act = async (fn: string, id: string, done: string) => { if (await attempt(() => rpc(fn, { id }), done)) load(); };

  return (
    <>
      <div className="spread" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ margin: 0, maxWidth: '64ch' }}>Write posts with the assistant, plan them for later, and publish to your LinkedIn profile. {connected ? 'Scheduled posts go out on time while databag is running.' : 'Connect LinkedIn under Settings to publish from here; until then, posts open in LinkedIn for you to paste.'}</p>
        <button className="btn primary" onClick={() => setEdit({ text: '', campaignId: '', when: '', topic: '' })}><Plus size={15} /> New post</button>
      </div>
      {posts.length === 0 ? <div className="empty">No posts yet.</div> : (
        <div className="li-posts">
          {posts.map((p) => (
            <div key={p.id} className="panel pad li-post">
              <div className="spread">
                <span className={`badge ${p.status === 'published' ? 'good' : p.status === 'scheduled' ? 'info' : ''}`} style={p.status === 'failed' ? { color: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}>
                  {p.status === 'published' ? `Posted ${when(p.published_at!)}` : p.status === 'scheduled' ? `Goes out ${new Date(p.scheduled_at!).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : p.status === 'failed' ? 'Could not post' : p.scheduled_at ? `Draft · suggested for ${new Date(p.scheduled_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Draft'}
                </span>
                {p.campaign && <span className="muted small">{p.campaign}</span>}
              </div>
              <p className="li-text">{p.text}</p>
              {p.error && <p className="error-text small">{p.error}</p>}
              {p.status !== 'published' && (
                <div className="acts-row">
                  <button className="btn" onClick={() => setEdit({ id: p.id, text: p.text, campaignId: p.campaign_id ?? '', when: local(p.scheduled_at), topic: '' })}>Edit or schedule</button>
                  {connected ? <button className="btn primary" onClick={() => window.confirm('Publish this on your LinkedIn profile now? Everyone can see it.') && act('li.publishNow', p.id, 'Posted on LinkedIn.')}><Send size={14} /> Post now</button>
                    : <><button className="btn" onClick={() => copyOpen(p)}><ExternalLink size={14} /> Copy and open LinkedIn</button><button className="btn ghost" onClick={() => act('li.markPosted', p.id, 'Marked as posted.')}>I posted it</button></>}
                  <button className="btn ghost icon" aria-label="Delete post" onClick={() => window.confirm('Delete this post?') && act('li.removePost', p.id, 'Deleted.')}><Trash2 size={15} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit post' : 'New post'} wide onClose={() => setEdit(null)}>
          <div className="ai-row" style={{ margin: '0 0 12px', borderRadius: 10 }}>
            <input className="input" aria-label="What is the post about?" placeholder="What is it about? e.g. “why we switched to local AI”" value={edit.topic} onChange={(e) => setEdit({ ...edit, topic: e.target.value })} />
            <button className="btn" disabled={busy || !edit.topic.trim()} onClick={draft}>{busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {busy ? 'Writing…' : 'Write it'}</button>
          </div>
          <textarea className="input li-editor" aria-label="Post" placeholder="Write your post…" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
          <div className="muted small" style={{ textAlign: 'right', color: edit.text.length > MAX ? 'var(--danger)' : undefined }}>{edit.text.length} / {MAX}</div>
          <div className="two">
            <Field label="Campaign"><select className="input" value={edit.campaignId} onChange={(e) => setEdit({ ...edit, campaignId: e.target.value })}><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Post on"><input className="input" type="datetime-local" value={edit.when} onChange={(e) => setEdit({ ...edit, when: e.target.value })} /></Field>
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={() => save(false)}>Save draft</button>
            <button className="btn primary" disabled={!edit.when || !edit.text.trim()} onClick={() => save(true)}>Schedule</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Leads({ campaigns, notify, attempt }: Shared & { campaigns: Campaign[] }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState({ campaignId: '', status: '' });
  const [audience, setAudience] = useState('');
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState<Partial<Lead> | null>(null);
  const [msg, setMsg] = useState<Lead | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const load = useCallback(() => rpc<Lead[]>('li.leads', { campaignId: filter.campaignId || undefined, status: filter.status || undefined }).then(setLeads).catch(() => {}), [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { rpc<{ audience: string }>('li.audience').then((a) => setAudience(a.audience)).catch(() => {}); }, []);
  const importCsv = async (f: File | undefined) => {
    if (!f) return;
    const csv = await f.text();
    await attempt(async () => { const r = await rpc<{ added: number; skipped: number }>('li.import', { csv, campaignId: filter.campaignId || undefined }); notify(`Imported ${r.added} lead${r.added === 1 ? '' : 's'}${r.skipped ? `; ${r.skipped} were already here` : ''}.`); load(); });
    if (picker.current) picker.current.value = '';
  };
  const score = async () => {
    setBusy('score');
    await rpc('li.saveAudience', { audience });
    await attempt(async () => { const r = await rpc<{ scored: number }>('li.score', { campaignId: filter.campaignId || undefined }); notify(`Scored ${r.scored} new lead${r.scored === 1 ? '' : 's'}.`); load(); });
    setBusy('');
  };
  const write = async (l: Lead) => {
    setBusy(l.id);
    await attempt(async () => { const { message } = await rpc<{ message: string }>('li.writeMessage', { id: l.id }); setMsg({ ...l, message }); load(); });
    setBusy('');
  };
  const sendYourself = async (l: Lead) => {
    await navigator.clipboard.writeText(l.message).catch(() => {});
    if (l.profile_url) window.open(l.profile_url, '_blank', 'noopener');
    await rpc('li.saveLead', { id: l.id, message: l.message, status: l.status === 'new' ? 'contacted' : l.status });
    notify('Message copied. Paste it into LinkedIn and send it yourself.');
    setMsg(null); load();
  };
  const set = async (l: Lead, patch: Partial<Lead>) => { if (await attempt(() => rpc('li.saveLead', { id: l.id, ...patch }))) load(); };

  return (
    <>
      <div className="panel pad" style={{ marginBottom: 14 }}>
        <Field label="Who is your ideal customer? (used to score leads)">
          <textarea className="input" style={{ height: 56, padding: 10 }} placeholder="e.g. Owners and operations managers of bakeries and cafés in the Netherlands with 5–50 staff" value={audience} onChange={(e) => setAudience(e.target.value)} />
        </Field>
        <div className="spread">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select className="tool-select" aria-label="Campaign" value={filter.campaignId} onChange={(e) => setFilter({ ...filter, campaignId: e.target.value })}><option value="">All campaigns</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select className="tool-select" aria-label="Stage" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><option value="">All stages</option>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy === 'score' || !audience.trim()} onClick={score}>{busy === 'score' ? <Loader2 size={15} className="spin" /> : <Star size={15} />} Score new leads</button>
            <input ref={picker} type="file" accept=".csv,text/csv" hidden onChange={(e) => importCsv(e.target.files?.[0])} />
            <button className="btn" onClick={() => picker.current?.click()} title="From LinkedIn: Settings → Data privacy → Get a copy of your data → Connections"><Upload size={15} /> Import Connections.csv</button>
            <button className="btn primary" onClick={() => setEdit({ name: '', headline: '', company: '', profile_url: '', email: '', campaign_id: filter.campaignId || null })}><UserPlus size={15} /> Add lead</button>
          </div>
        </div>
      </div>
      {leads.length === 0 ? <div className="empty">No leads yet. Import your LinkedIn connections, or add people you want to reach.</div> : (
        <table className="table">
          <thead><tr><th>Fit</th><th>Person</th><th>Stage</th><th>Campaign</th><th /></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td title={l.score_reason}>{l.score ? <span className="score">{'★'.repeat(l.score)}<span className="muted">{'★'.repeat(5 - l.score)}</span></span> : <span className="muted small">not scored</span>}</td>
                <td>
                  <strong>{l.name}</strong> {l.profile_url && <a href={l.profile_url} target="_blank" rel="noreferrer noopener" className="muted" aria-label={`${l.name} on LinkedIn`}><ExternalLink size={12} /></a>}
                  <div className="muted small">{[l.headline, l.company].filter(Boolean).join(' · ')}</div>
                  {l.score_reason && <div className="muted small">{l.score_reason}</div>}
                </td>
                <td><select className="tool-select" aria-label={`Stage for ${l.name}`} value={l.status} onChange={(e) => set(l, { status: e.target.value })}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></td>
                <td><select className="tool-select" aria-label={`Campaign for ${l.name}`} value={l.campaign_id ?? ''} onChange={(e) => set(l, { campaign_id: e.target.value || null })}><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                <td className="acts">
                  <button className="btn" disabled={busy === l.id} onClick={() => write(l)}>{busy === l.id ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Message</button>
                  {l.email && <a className="btn ghost icon" href={`/mail?to=${encodeURIComponent(l.email)}`} title="Email" aria-label={`Email ${l.name}`}><Mail size={15} /></a>}
                  <button className="btn ghost" disabled={!!l.contact_id} onClick={async () => { if (await attempt(() => rpc('li.toCrm', { id: l.id }), `${l.name} is now in the CRM.`)) load(); }}>{l.contact_id ? 'In CRM' : 'To CRM'}</button>
                  <button className="btn ghost icon" aria-label={`Edit ${l.name}`} onClick={() => setEdit(l)}>…</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {msg && (
        <Modal title={`Message to ${msg.name}`} onClose={() => setMsg(null)}>
          <textarea className="input" style={{ height: 160, padding: 10 }} aria-label="Message" value={msg.message} onChange={(e) => setMsg({ ...msg, message: e.target.value })} />
          <p className="muted small">LinkedIn does not allow apps to send private messages for you, so this opens their profile with the message copied. Paste it and press send yourself.</p>
          <div className="modal-foot"><button className="btn primary" onClick={() => sendYourself(msg)}><Copy size={14} /> Copy and open their profile</button></div>
        </Modal>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit lead' : 'Add a lead'} onClose={() => setEdit(null)}>
          <Field label="Name"><input className="input" autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="two">
            <Field label="Role"><input className="input" value={edit.headline ?? ''} onChange={(e) => setEdit({ ...edit, headline: e.target.value })} /></Field>
            <Field label="Company"><input className="input" value={edit.company ?? ''} onChange={(e) => setEdit({ ...edit, company: e.target.value })} /></Field>
          </div>
          <Field label="LinkedIn profile link"><input className="input" placeholder="https://www.linkedin.com/in/…" value={edit.profile_url ?? ''} onChange={(e) => setEdit({ ...edit, profile_url: e.target.value })} /></Field>
          <Field label="Email (optional)"><input className="input" type="email" value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="input" style={{ height: 60, padding: 10 }} value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <div className="modal-foot">
            {edit.id && <button className="btn ghost" onClick={async () => { if (window.confirm(`Delete ${edit.name}?`) && (await attempt(() => rpc('li.removeLead', { id: edit.id }), 'Deleted.'))) { setEdit(null); load(); } }}><Trash2 size={14} /> Delete</button>}
            <button className="btn primary" onClick={async () => { if (await attempt(() => rpc('li.saveLead', edit), 'Saved.')) { setEdit(null); load(); } }}>Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Campaigns({ campaigns, reload, attempt, notify }: Shared & { campaigns: Campaign[]; reload: () => void }) {
  const [edit, setEdit] = useState<Partial<Campaign> | null>(null);
  const [busy, setBusy] = useState('');
  const plan = async (c: Campaign) => {
    setBusy(c.id);
    await attempt(async () => { const r = await rpc<{ drafted: number }>('li.planPosts', { id: c.id, count: 4 }); notify(`${r.drafted} posts drafted, one every three days. Read and schedule them under Posts.`); reload(); });
    setBusy('');
  };
  return (
    <>
      <div className="spread" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ margin: 0, maxWidth: '64ch' }}>A campaign ties together what you post, who you reach out to and how it is going. The assistant drafts a series of posts and personal messages from the goal and audience you describe.</p>
        <button className="btn primary" onClick={() => setEdit({ name: '', goal: '', audience: '', offer: '' })}><Plus size={15} /> New campaign</button>
      </div>
      {campaigns.length === 0 ? <div className="empty">No campaigns yet.</div> : (
        <div className="people">
          {campaigns.map((c) => {
            const total = Object.values(c.leads).reduce((s, n) => s + n, 0);
            return (
              <div key={c.id} className="panel pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="spread"><strong>{c.name}</strong><span className={`badge ${c.status === 'active' ? 'good' : ''}`}>{c.status}</span></div>
                {c.goal && <div className="muted small">{c.goal}</div>}
                <div className="small">{c.posts.published} posted · {c.posts.scheduled} scheduled · {c.posts.n - c.posts.published - c.posts.scheduled} drafts</div>
                <div className="small">{total} leads{total ? ` · ${c.leads.contacted ?? 0} contacted · ${c.leads.replied ?? 0} replied · ${c.leads.meeting ?? 0} meetings · ${c.leads.won ?? 0} won` : ''}</div>
                <div className="acts-row">
                  <button className="btn" disabled={busy === c.id} onClick={() => plan(c)}>{busy === c.id ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {busy === c.id ? 'Writing posts…' : 'Draft 4 posts'}</button>
                  <button className="btn ghost" onClick={() => setEdit(c)}>Edit</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit campaign' : 'New campaign'} onClose={() => setEdit(null)}>
          <Field label="Name"><input className="input" autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Goal"><input className="input" placeholder="e.g. Book 10 demo calls with cafés before Christmas" value={edit.goal ?? ''} onChange={(e) => setEdit({ ...edit, goal: e.target.value })} /></Field>
          <Field label="Who it is for"><textarea className="input" style={{ height: 56, padding: 10 }} value={edit.audience ?? ''} onChange={(e) => setEdit({ ...edit, audience: e.target.value })} /></Field>
          <Field label="What you offer"><textarea className="input" style={{ height: 56, padding: 10 }} value={edit.offer ?? ''} onChange={(e) => setEdit({ ...edit, offer: e.target.value })} /></Field>
          {edit.id && <label className="sign-agree"><input type="checkbox" checked={edit.status !== 'paused'} onChange={(e) => setEdit({ ...edit, status: e.target.checked ? 'active' : 'paused' })} /> Active</label>}
          <div className="modal-foot">
            {edit.id && <button className="btn ghost" onClick={async () => { if (window.confirm(`Delete "${edit.name}"? Its unpublished posts are deleted; its leads are kept.`) && (await attempt(() => rpc('li.removeCampaign', { id: edit.id }), 'Deleted.'))) { setEdit(null); reload(); } }}><Trash2 size={14} /> Delete</button>}
            <button className="btn primary" onClick={async () => { if (await attempt(() => rpc('li.saveCampaign', edit), 'Saved.')) { setEdit(null); reload(); } }}>Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Connect({ status, reload, attempt }: { status: Status; reload: () => void; attempt: Shared['attempt'] }) {
  const [form, setForm] = useState({ clientId: status.clientId, clientSecret: '' });
  const redirect = typeof window === 'undefined' ? '' : `${window.location.origin}/api/linkedin/callback`;
  return (
    <div style={{ maxWidth: 720 }}>
      <h2 className="section">Connect your LinkedIn account</h2>
      <div className="panel pad stack">
        {status.connected ? (
          <div className="spread"><span>Connected as <strong>{status.name || 'your account'}</strong>{status.expires ? <span className="muted"> · until {new Date(status.expires).toLocaleDateString()}</span> : null}</span><button className="btn" onClick={async () => { if (await attempt(() => rpc('li.disconnect'), 'Disconnected.')) reload(); }}>Disconnect</button></div>
        ) : (
          <>
            <ol className="steps">
              <li>Create a free app at <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noreferrer noopener">linkedin.com/developers</a>, linked to your company page.</li>
              <li>Under Products, add “Sign In with LinkedIn using OpenID Connect” and “Share on LinkedIn”.</li>
              <li>Under Auth, add this redirect URL: <code className="mono">{redirect}</code></li>
              <li>Copy the client ID and client secret below, then press Connect.</li>
            </ol>
            <div className="two">
              <Field label="Client ID"><input className="input mono" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} /></Field>
              <Field label="Client secret"><input className="input mono" type="password" autoComplete="off" placeholder={status.appSet ? 'saved (leave empty to keep)' : ''} value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} /></Field>
            </div>
            <div className="acts-row">
              <button className="btn" onClick={async () => { if (await attempt(() => rpc('li.saveApp', form), 'Saved.')) reload(); }}>Save</button>
              <a className={`btn primary ${status.appSet ? '' : 'disabled'}`} href={status.appSet ? '/api/linkedin/connect' : undefined} aria-disabled={!status.appSet}>Connect LinkedIn</a>
            </div>
          </>
        )}
      </div>
      <h2 className="section">What databag does and does not do on LinkedIn</h2>
      <div className="panel pad small" style={{ lineHeight: 1.7 }}>
        It publishes posts you wrote or approved on your own profile, using LinkedIn’s official API. It never sends connection requests or private messages for you, and never collects data from LinkedIn pages: LinkedIn forbids that, and accounts that do it get restricted. Messages are written here and sent by you. Leads come from your own LinkedIn data export or are added by hand. Posting as a company page needs LinkedIn’s approval for its Community Management API.
      </div>
    </div>
  );
}
