'use client';

import { useState } from 'react';
import { call } from '@/lib/client';
import { Brand } from './Brand';

function useSubmit(action: () => Promise<unknown>) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await action();
      window.location.href = '/';
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return { error, busy, submit };
}

export function LoginForm({ company, logo }: { company: string; logo?: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, submit } = useSubmit(() => call('/api/login', { body: { email, password } }));
  return (
    <form className="auth-card" onSubmit={submit}>
      <Brand logo={logo} />
      <h1>Sign in</h1>
      <p>to {company}</p>
      <div className="field">
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <div className="error field">{error}</div>}
      <button className="btn primary" style={{ width: '100%', justifyContent: 'center', height: 36 }} disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

type Choice = { id: string; name: string; sub: string; price?: number };

/** First run, in three steps: who you are, what you pay for today, what you do most. */
export function SetupForm({ defaults, tools, jobs, needsCode }: { defaults: { company: string; domain: string }; tools: Choice[]; jobs: Choice[]; needsCode?: boolean }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ company: defaults.company, domain: defaults.domain, name: '', handle: '', password: '', setupCode: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [shortcuts, setShortcuts] = useState<string[]>(['invoice', 'email', 'meeting', 'doc'].filter((id) => jobs.some((j) => j.id === id)));
  const [stepError, setStepError] = useState('');
  const [logo, setLogo] = useState<File | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const { error, busy, submit } = useSubmit(async () => {
    await call('/api/setup', { body: { ...f, tools: picked, shortcuts } });
    // The logo is optional and can be added later in Settings, so a failed upload does not stop setup.
    if (logo) { const form = new FormData(); form.append('logo', logo); await fetch('/api/brand/logo', { method: 'POST', body: form }).catch(() => {}); }
  });
  const toggle = (list: string[], setList: (l: string[]) => void, id: string) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const saving = tools.filter((t) => picked.includes(t.id)).reduce((n, t) => n + (t.price ?? 0), 0);
  const next = (e: React.FormEvent) => {
    if (step < 2) {
      e.preventDefault();
      if (step === 0 && !(e.currentTarget as HTMLFormElement).reportValidity()) return;
      setStepError(''); setStep(step + 1);
    } else submit(e);
  };

  return (
    <form className="setup" onSubmit={next} noValidate={step > 0}>
      <div className="setup-top">
        <div className="brand-mark"><span>d</span></div>
        <div className="setup-dots">{[0, 1, 2].map((i) => <div key={i} className={i <= step ? 'on' : ''} />)}</div>
        <span className="mono muted">Step {step + 1} of 3</span>
      </div>

      {step === 0 && (
        <div className="setup-step">
          <h1>{needsCode ? 'databag is ready for your company.' : 'databag is installed on this Mac.'}</h1>
          <p>Mail, documents, invoices, customers and more, in one place. {needsCode ? 'Your data is kept in your own database.' : 'Your data stays on this computer.'} Setup takes about two minutes.</p>
          <div className="form-grid">
            <label className="field"><span className="label">Your name</span><input className="input big" required autoComplete="name" autoFocus value={f.name} onChange={set('name')} /></label>
            <label className="field"><span className="label">Company name</span><input className="input big" required value={f.company} onChange={set('company')} /></label>
            <label className="field"><span className="label">Email domain</span><input className="input big" required placeholder="acme.com" pattern="[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+" value={f.domain} onChange={set('domain')} /></label>
            <label className="field"><span className="label">Your email address</span>
              <div className="split"><input className="input big" required placeholder="you" pattern="[A-Za-z0-9._\-]+" value={f.handle} onChange={set('handle')} /><span className="suffix">@{f.domain || 'domain'}</span></div>
            </label>
            <label className="field"><span className="label">Password (8 characters or more)</span><input className="input big" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></label>
            <label className="field"><span className="label">Company logo (optional, PNG, JPG or SVG; you can add it later in Settings)</span>
              <div className="split" style={{ alignItems: 'center', gap: 10 }}>
                {logo && <img src={URL.createObjectURL(logo)} alt="" className="brand-logo" style={{ width: 40, height: 40 }} />}
                <input className="input big" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
              </div>
            </label>
            {needsCode && <label className="field"><span className="label">Setup code (the CRON_SECRET or DATABAG_SETUP_CODE you set when deploying)</span><input className="input big" type="password" required autoComplete="off" value={f.setupCode} onChange={set('setupCode')} /></label>}
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="setup-step">
          <h1>Which tools do you pay for today?</h1>
          <p>Pick any you use. databag has a replacement for each, and Settings will show what you can cancel.</p>
          <div className="choice-grid">
            {tools.map((t) => (
              <button type="button" key={t.id} className={`choice ${picked.includes(t.id) ? 'on' : ''}`} aria-pressed={picked.includes(t.id)} onClick={() => toggle(picked, setPicked, t.id)}>
                <strong>{t.name}</strong><span>becomes {t.sub}</span>
              </button>
            ))}
          </div>
          <div className="panel pad saving"><span className="serif">${saving}</span><span className="muted">a month across {picked.length} subscription{picked.length === 1 ? '' : 's'} you could cancel. Estimate from typical single-seat prices.</span></div>
        </div>
      )}
      {step === 2 && (
        <div className="setup-step">
          <h1>What do you do most?</h1>
          <p>These become one-click shortcuts on your home screen.</p>
          <div className="chips">
            {jobs.map((j) => <button type="button" key={j.id} className={`chip ${shortcuts.includes(j.id) ? 'on' : ''}`} aria-pressed={shortcuts.includes(j.id)} onClick={() => toggle(shortcuts, setShortcuts, j.id)}>{j.name}</button>)}
          </div>
        </div>
      )}

      {(error || stepError) && <div className="error">{error || stepError}</div>}
      <div className="setup-foot">
        {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        <button className="btn primary big" disabled={busy}>{step < 2 ? 'Continue' : busy ? 'Setting up…' : 'Open databag'}</button>
      </div>
    </form>
  );
}
