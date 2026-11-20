'use client';

import { useCallback, useEffect, useState } from 'react';
import { call, initials, when } from '@/lib/client';
import { useToast } from './ui';

type Person = { id: string; name: string; email: string; role: string };
type ToolRow = { id: string; name: string; price: number; appNames: string[]; installed: boolean };
type Machine = { ai: { ok: boolean; model: string; installed: boolean }; memory: { appMb: number; usedGb: number; totalGb: number }; disk: { usedGb: number; totalGb: number } | null };
type Backups = { folder: string; backups: { name: string; created_at: number; bytes: number }[] };
type Props = {
  me: { name: string; isAdmin: boolean }; company: { name: string; domain: string; accent?: string }; ai: { baseUrl: string; model: string };
  logo: string | null; aiSetup: { provider: AiProvider; model: string; baseUrl: string; hasKey: boolean; fromEnv: boolean };
  smtpPort: number; hasRelay: boolean; tools: ToolRow[]; chosenTools: string[];
  agent: { confirm: 'send' | 'all'; cleanup: boolean };
};
type AiProvider = 'local' | 'openrouter' | 'openai' | 'custom';
const ACCENTS = [['#1f6b4f', 'Green'], ['#2f4bbf', 'Blue'], ['#b4532a', 'Clay'], ['#5b3f8c', 'Plum']];
const mb = (b: number) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;

function Meter({ label, value, used, total }: { label: string; value: string; used: number; total: number }) {
  return (
    <div className="meter">
      <div className="meter-head"><span>{label}</span><span className="mono muted">{value}</span></div>
      <div className="meter-bar"><div style={{ width: `${Math.min(100, Math.round((used / (total || 1)) * 100))}%` }} /></div>
    </div>
  );
}

export function SettingsView({ me, company, ai, smtpPort, hasRelay, tools, chosenTools, agent, logo: savedLogo, aiSetup }: Props) {
  const [logo, setLogo] = useState(savedLogo);
  const [aiForm, setAiForm] = useState({ provider: aiSetup.provider, model: aiSetup.model, baseUrl: aiSetup.baseUrl, apiKey: '' });
  const uploadLogo = async (file?: File) => {
    if (!file) return;
    const form = new FormData(); form.append('logo', file);
    await attempt(async () => {
      const res = await fetch('/api/brand/logo', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed.');
      setLogo(data.url);
    }, 'Logo saved. Reload to see it everywhere.');
  };
  const saveAi = (e: React.FormEvent) => { e.preventDefault(); save({ ai: aiForm }, 'AI settings saved.').then((ok) => ok && setAiForm((f) => ({ ...f, apiKey: '' }))); };
  const [agentPrefs, setAgentPrefs] = useState(agent);
  const [people, setPeople] = useState<Person[]>([]);
  const [form, setForm] = useState({ name: '', handle: '', password: '' });
  const [machine, setMachine] = useState<Machine | null>(null);
  const [backups, setBackups] = useState<Backups | null>(null);
  const [chosen, setChosen] = useState<string[]>(chosenTools);
  const [names, setNames] = useState({ mine: me.name, company: company.name });
  const [folder, setFolder] = useState('');
  const [accent, setAccent] = useState('');
  const [busy, setBusy] = useState('');
  const { toast, notify, attempt } = useToast();

  const loadPeople = () => call<{ users: Person[] }>('/api/users').then((d) => setPeople(d.users)).catch(() => {});
  const loadBackups = useCallback(() => call<Backups>('/api/backup').then((b) => { setBackups(b); setFolder((f) => f || b.folder); }).catch(() => {}), []);
  useEffect(() => {
    loadPeople(); loadBackups();
    call<Machine>('/api/system').then(setMachine).catch(() => {});
    try { setAccent(localStorage.getItem('databag-accent') || '#1f6b4f'); } catch { setAccent('#1f6b4f'); }
  }, [loadBackups]);

  const save = (body: object, done = 'Saved.') => attempt(() => call('/api/settings', { method: 'PATCH', body }), done);
  const addPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await attempt(() => call('/api/users', { body: form }), 'Added.')) { setForm({ name: '', handle: '', password: '' }); loadPeople(); }
  };
  const backupNow = async () => { setBusy('backup'); if (await attempt(() => call('/api/backup', { method: 'POST' }), 'Backup made.')) loadBackups(); setBusy(''); };
  const toggleTool = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    setChosen(next);
    if (me.isAdmin) save({ tools: next }, '');
  };
  const pickAccent = (c: string) => {
    setAccent(c);
    document.documentElement.style.setProperty('--ac', c);
    try { localStorage.setItem('databag-accent', c); } catch {}
  };
  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('databag-theme', next); } catch {}
    notify(`Switched to ${next} mode.`);
  };
  const saving = tools.filter((t) => chosen.includes(t.id)).reduce((s, t) => s + t.price, 0);
  const last = backups?.backups[0];

  return (
    <div className="page settings">
      <h1>Settings</h1>

      <h2>You and your company</h2>
      <div className="panel pad form-grid">
        <label className="field">
          <span className="label">Your name</span>
          <input className="input" value={names.mine} onChange={(e) => setNames({ ...names, mine: e.target.value })} onBlur={() => names.mine !== me.name && save({ myName: names.mine })} />
        </label>
        <label className="field">
          <span className="label">Company name</span>
          <input className="input" disabled={!me.isAdmin} value={names.company} onChange={(e) => setNames({ ...names, company: e.target.value })} onBlur={() => names.company !== company.name && save({ company: names.company }, 'Saved. Reload to see it in the sidebar.')} />
        </label>
        <div className="field"><span className="label">Email domain</span><div className="mono" style={{ paddingTop: 10 }}>{company.domain}</div></div>
        <div className="field"><span className="label">Logo</span>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            {logo ? <img src={logo} alt="Company logo" className="brand-logo" style={{ width: 40, height: 40 }} /> : <span className="muted small">No logo yet</span>}
            {me.isAdmin && <label className="btn">Upload<input type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => uploadLogo(e.target.files?.[0])} /></label>}
            {me.isAdmin && logo && <button className="btn ghost" onClick={() => attempt(() => call('/api/brand/logo', { method: 'DELETE' }), 'Logo removed.').then((ok) => ok && setLogo(null))}>Remove</button>}
          </div>
        </div>
      </div>

      <h2>This machine</h2>
      <div className="panel pad stack">
        {machine ? (
          <>
            <Meter label="Memory in use" value={`${machine.memory.usedGb} of ${machine.memory.totalGb} GB · databag ${machine.memory.appMb} MB`} used={machine.memory.usedGb} total={machine.memory.totalGb} />
            {machine.disk && <Meter label="Storage" value={`${machine.disk.usedGb} of ${machine.disk.totalGb} GB`} used={machine.disk.usedGb} total={machine.disk.totalGb} />}
            <div className="spread"><span>Local AI model</span><span className="mono muted">{machine.ai.ok && machine.ai.installed ? `${ai.model} · ready · runs on this machine` : machine.ai.ok ? `${ai.model} is not installed` : `not reachable at ${ai.baseUrl}`}</span></div>
          </>
        ) : <span className="muted">Checking…</span>}
        <div className="spread">
          <span>Backup <span className="muted">· {last ? `last ${when(last.created_at)}, ${mb(last.bytes)}` : 'none yet'} · one is made every day while databag runs</span></span>
          {me.isAdmin && <button className="btn" disabled={busy === 'backup'} onClick={backupNow}>{busy === 'backup' ? 'Backing up…' : 'Back up now'}</button>}
        </div>
        {me.isAdmin && (
          <form className="spread" onSubmit={(e) => { e.preventDefault(); save({ backupDir: folder }, 'Backup folder saved.').then(loadBackups); }}>
            <input className="input mono" style={{ flex: 1, minWidth: 220 }} aria-label="Backup folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/Volumes/Backup/databag" />
            <button className="btn">Use this folder</button>
          </form>
        )}
        {!!backups?.backups.length && (
          <details>
            <summary className="muted small">{backups.backups.length} backup{backups.backups.length === 1 ? '' : 's'} kept in {backups.folder}</summary>
            <div className="mono small muted" style={{ marginTop: 8, lineHeight: 1.8 }}>
              {backups.backups.map((b) => <div key={b.name}>{b.name} · {mb(b.bytes)}</div>)}
              <div style={{ marginTop: 6 }}>To restore one, stop databag and run: databag restore &lt;folder&gt;</div>
            </div>
          </details>
        )}
      </div>

      <h2>AI</h2>
      {aiSetup.fromEnv ? (
        <div className="panel pad muted">The AI is set by this server’s environment variables ({ai.model} at {ai.baseUrl}). Change them in your host’s settings.</div>
      ) : (
        <form className="panel pad stack" onSubmit={saveAi}>
          <div className="choice-grid">
            {([['local', 'On this machine', 'Gemma 4 through Ollama. Free and private.'], ['openrouter', 'OpenRouter', 'Hundreds of hosted models with one key.'], ['openai', 'OpenAI', 'GPT models with your OpenAI key.'], ['custom', 'Other endpoint', 'LM Studio, vLLM or any OpenAI-compatible address.']] as const).map(([v, l, d]) => (
              <button key={v} type="button" disabled={!me.isAdmin} className={`choice ${aiForm.provider === v ? 'on' : ''}`} aria-pressed={aiForm.provider === v}
                onClick={() => setAiForm({ ...aiForm, provider: v, model: v === aiSetup.provider ? aiSetup.model : v === 'local' ? 'gemma4:e4b' : v === 'openrouter' ? 'google/gemini-2.5-flash' : v === 'openai' ? 'gpt-4.1-mini' : '' })}><strong>{l}</strong><span>{d}</span></button>
            ))}
          </div>
          <div className="two">
            {aiForm.provider === 'custom' && <label className="field"><span className="label">Endpoint address</span><input className="input mono" disabled={!me.isAdmin} placeholder="http://127.0.0.1:1234/v1" value={aiForm.baseUrl} onChange={(e) => setAiForm({ ...aiForm, baseUrl: e.target.value })} /></label>}
            <label className="field"><span className="label">Model (must support tool calling)</span><input className="input mono" disabled={!me.isAdmin} value={aiForm.model} onChange={(e) => setAiForm({ ...aiForm, model: e.target.value })} /></label>
            {aiForm.provider !== 'local' && <label className="field"><span className="label">API key {aiSetup.hasKey && aiForm.provider === aiSetup.provider ? '(saved; leave empty to keep it)' : ''}</span><input className="input" type="password" autoComplete="off" disabled={!me.isAdmin} value={aiForm.apiKey} onChange={(e) => setAiForm({ ...aiForm, apiKey: e.target.value })} /></label>}
          </div>
          {me.isAdmin && <div><button className="btn primary">Save AI settings</button></div>}
          <div className="muted small">Each agent can also use its own model; see the Agents app.</div>
        </form>
      )}

      <h2>Agent and voice</h2>
      <div className="panel">
        <label className="panel-row compact" style={{ cursor: me.isAdmin ? 'pointer' : 'default' }}>
          <span className="grow"><strong style={{ fontWeight: 500 }}>Ask before every change</strong><div className="muted small">Off: the agent asks first only for things that reach other people (email, invitations, invoices, chat). On: it also asks before adding tasks, contacts, invoices and events.</div></span>
          <input type="checkbox" disabled={!me.isAdmin} checked={agentPrefs.confirm === 'all'} onChange={(e) => { const confirm = e.target.checked ? 'all' : 'send'; setAgentPrefs({ ...agentPrefs, confirm }); save({ agentConfirm: confirm }); }} />
        </label>
        <label className="panel-row compact" style={{ cursor: me.isAdmin ? 'pointer' : 'default' }}>
          <span className="grow"><strong style={{ fontWeight: 500 }}>Tidy up dictation</strong><div className="muted small">Removes “um”, false starts and repeats, and adds punctuation. Hold the right ⌥ key anywhere to dictate; speech is written down by your AI model.</div></span>
          <input type="checkbox" disabled={!me.isAdmin} checked={agentPrefs.cleanup} onChange={(e) => { setAgentPrefs({ ...agentPrefs, cleanup: e.target.checked }); save({ speechCleanup: e.target.checked }); }} />
        </label>
      </div>

      <h2>Subscriptions you can cancel {saving > 0 && <span className="muted" style={{ fontWeight: 400 }}>about ${saving} a month</span>}</h2>
      <div className="panel">
        {tools.map((t) => (
          <label key={t.id} className="panel-row compact" style={{ cursor: me.isAdmin ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={chosen.includes(t.id)} disabled={!me.isAdmin} onChange={() => toggleTool(t.id)} />
            <span className="grow" style={{ fontWeight: 500 }}>{t.name}</span>
            <span className="muted small">now {t.appNames.join(', ')}</span>
            <span className="mono small" style={{ width: 120, textAlign: 'right', color: !chosen.includes(t.id) ? 'var(--text-subtle)' : t.installed ? 'var(--accent)' : 'var(--warn)' }}>
              {!chosen.includes(t.id) ? 'not used' : t.installed ? 'ready to cancel' : 'app not installed'}
            </span>
          </label>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Tick the tools you pay for today. Prices are typical single-seat list prices, as a rough guide.</p>

      <h2>People</h2>
      <div className="panel">
        {people.map((p) => (
          <div key={p.id} className="panel-row compact">
            <div className="avatar">{initials(p.name)}</div>
            <span className="grow">{p.name} <span className="muted mono">{p.email}</span></span>
            <span className="pill">{p.role}</span>
          </div>
        ))}
      </div>
      {me.isAdmin && (
        <form className="panel pad" style={{ marginTop: 10 }} onSubmit={addPerson}>
          <div className="inline-form">
            <div className="field">
              <label className="label" htmlFor="p-name">Name</label>
              <input id="p-name" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor="p-handle">Email</label>
              <div className="split">
                <input id="p-handle" className="input" required value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} />
                <span className="suffix">@{company.domain}</span>
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="p-pass">Password</label>
              <input id="p-pass" className="input" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <button className="btn primary" style={{ height: 38 }}>Add person</button>
          </div>
        </form>
      )}

      <h2>Mail</h2>
      <div className="panel">
        <div className="panel-row compact"><span className="grow">Receives mail on port</span><span className="mono">{smtpPort}</span></div>
        <div className="panel-row compact"><span className="grow">Sending outside the company</span><span>{hasRelay ? 'Relay configured' : 'Not set up yet'}</span></div>
      </div>

      <h2>Look</h2>
      <div className="panel pad spread">
        <div className="swatches" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map(([c, n]) => (
            <button key={c} role="radio" aria-checked={accent === c} aria-label={n} title={n} className={`swatch-dot ${accent === c ? 'on' : ''}`} style={{ background: c }} onClick={() => pickAccent(c)} />
          ))}
        </div>
        <span className="row" style={{ gap: 8 }}>
          {me.isAdmin && <button className="btn" onClick={() => save({ accent }, 'This is now the company colour for everyone.')}>Make this the company colour</button>}
          <button className="btn" onClick={toggleTheme}>Switch light or dark</button>
        </span>
      </div>
      {toast}
    </div>
  );
}
