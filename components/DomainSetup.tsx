'use client';

import { Check, Copy, Globe, Loader2, Mail, RefreshCw, Send, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { call } from '@/lib/client';
import { useToast } from './ui';

type Rec = { purpose: string; type: string; name: string; value: string; priority?: number; required: boolean; ok?: boolean; found?: string[] };
type Info = { domain: string; url: string; ip: string | null; mode: 'relay' | 'direct' | 'off'; relay: { host: string; port: number; user: string; hasPass: boolean } | null; relayFromEnv: boolean; records: Rec[] };
type Check = { ip: string | null; records: Rec[]; verified: boolean; ready: boolean };
type Delivery = { to: string; status: string; detail?: string };

/**
 * Connect the company's domain: where databag is reached, the DNS records that prove the
 * domain is yours and let mail reach the internet, and how mail leaves (direct or relay).
 * Used in onboarding (/welcome) and in Settings.
 */
export function DomainSetup({ onboarding }: { onboarding?: boolean }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [url, setUrl] = useState('');
  const [relay, setRelay] = useState({ host: '', port: '587', user: '', pass: '' });
  const [testTo, setTestTo] = useState('');
  const [test, setTest] = useState<Delivery[] | null>(null);
  const [busy, setBusy] = useState('');
  const { toast, attempt } = useToast();

  const load = useCallback(async () => {
    const i = await call<Info>('/api/domain').catch(() => null);
    if (!i) return;
    setInfo(i);
    setUrl(i.url || `https://os.${i.domain}`);
    if (i.relay) setRelay({ host: i.relay.host, port: String(i.relay.port), user: i.relay.user, pass: '' });
  }, []);
  useEffect(() => { load(); }, [load]);

  const runCheck = async () => { setChecking(true); await attempt(async () => setCheck(await call<Check>('/api/domain', { body: { action: 'check' } }))); setChecking(false); };
  const save = (body: object, done: string) => attempt(() => call('/api/domain', { method: 'PATCH', body }), done).then((ok) => { if (ok) load(); return ok; });
  const sendTest = async () => { setBusy('test'); setTest(null); await attempt(async () => setTest((await call<{ delivery: Delivery[] }>('/api/domain', { body: { action: 'test', to: testTo } })).delivery)); setBusy(''); };
  const copy = (v: string) => navigator.clipboard?.writeText(v);

  if (!info) return <div className="muted"><Loader2 size={15} className="spin" /> Loading…</div>;
  const records = check?.records ?? info.records;

  return (
    <div className="stack">
      <section className="panel pad stack">
        <div className="row" style={{ gap: 10 }}><Globe size={16} /><strong>Where your team opens databag</strong></div>
        <p className="muted small" style={{ margin: 0 }}>
          The address used in invitations, signing links and booking pages, instead of localhost. Point it at this machine with the A record below, then put HTTPS in front
          (a Cloudflare Tunnel or Caddy; see the install guide).{info.ip ? <> This machine’s public IP address is <span className="mono">{info.ip}</span>.</> : ''}
        </p>
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); save({ url }, 'Address saved.'); }}>
          <input className="input mono" style={{ flex: 1 }} aria-label="Public address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`https://os.${info.domain}`} />
          <button className="btn">Save address</button>
        </form>
      </section>

      <section className="panel pad stack">
        <div className="spread">
          <div className="row" style={{ gap: 10 }}><Check size={16} /><strong>DNS records for {info.domain}</strong></div>
          <button className="btn primary" onClick={runCheck} disabled={checking}>{checking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {checking ? 'Checking…' : 'Check my domain'}</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Sign in at your domain provider (GoDaddy, Namecheap, Cloudflare, Google Domains, TransIP…), open the DNS settings for {info.domain} and add these records.
          Then click <strong>Check my domain</strong>: databag looks them up in public DNS, which proves the domain is yours. Changes can take a few minutes to an hour to show.
        </p>
        {check && (
          <div className={`notice ${check.ready ? '' : 'warn'}`} style={{ marginTop: 0 }}>
            {check.ready ? 'All required records are in place. Your domain is verified and mail is set up.' : check.verified ? 'The domain is verified. Some mail records are still missing.' : 'Not verified yet. Add the records, wait a few minutes, then check again.'}
          </div>
        )}
        <div className="dns-table" role="table">
          <div className="dns-row head" role="row"><span>Type</span><span>Name / host</span><span>Value</span><span /></div>
          {records.map((r, i) => (
            <div key={i} className="dns-row" role="row">
              <span className="mono">{r.type}{r.priority ? ` ${r.priority}` : ''}</span>
              <span className="mono small">{r.name}<div className="muted">{r.purpose}{r.required ? '' : ' (recommended)'}</div></span>
              <span className="mono small dns-value">{r.value}<button className="btn ghost icon" aria-label="Copy value" title="Copy" onClick={() => copy(r.value)}><Copy size={13} /></button></span>
              <span>{r.ok === undefined ? null : r.ok ? <span className="badge good"><Check size={11} /> found</span> : <span className="badge warn" title={r.found?.length ? `Found instead: ${r.found.join(', ')}` : 'Not found'}><X size={11} /> missing</span>}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel pad stack">
        <div className="row" style={{ gap: 10 }}><Mail size={16} /><strong>Mail to the internet</strong></div>
        <div className="choice-grid">
          <button type="button" className={`choice ${info.mode === 'direct' ? 'on' : ''}`} onClick={() => save({ relay: null, outbound: 'direct' }, 'databag now delivers mail itself.')} disabled={info.relayFromEnv}>
            <strong>Deliver directly</strong><span>databag sends to each recipient’s mail server itself, signed with your DKIM key. Needs outgoing port 25 (open on most servers, blocked on most home internet).</span>
          </button>
          <button type="button" className={`choice ${info.mode === 'relay' ? 'on' : ''}`} onClick={() => document.getElementById('relay-host')?.focus()}>
            <strong>Through a relay</strong><span>Hand mail to an SMTP service: Resend, Postmark, Amazon SES, Gmail or your current provider. Works from any network.</span>
          </button>
          <button type="button" className={`choice ${info.mode === 'off' ? 'on' : ''}`} onClick={() => save({ relay: null, outbound: 'off' }, 'Mail now stays inside the company.')} disabled={info.relayFromEnv}>
            <strong>Inside the company only</strong><span>Colleagues can email each other; nothing goes out.</span>
          </button>
        </div>
        {!info.relayFromEnv && (
          <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); save({ relay: { host: relay.host, port: Number(relay.port), user: relay.user, pass: relay.pass } }, 'Relay saved.').then(() => setRelay((r) => ({ ...r, pass: '' }))); }}>
            <div className="two">
              <label className="field"><span className="label">Relay server</span><input id="relay-host" className="input mono" placeholder="smtp.resend.com" value={relay.host} onChange={(e) => setRelay({ ...relay, host: e.target.value })} /></label>
              <label className="field"><span className="label">Port</span><input className="input mono" value={relay.port} onChange={(e) => setRelay({ ...relay, port: e.target.value })} /></label>
              <label className="field"><span className="label">User name</span><input className="input mono" autoComplete="off" value={relay.user} onChange={(e) => setRelay({ ...relay, user: e.target.value })} /></label>
              <label className="field"><span className="label">Password or API key {info.relay?.hasPass ? '(saved; leave empty to keep it)' : ''}</span><input className="input" type="password" autoComplete="new-password" value={relay.pass} onChange={(e) => setRelay({ ...relay, pass: e.target.value })} /></label>
            </div>
            <div><button className="btn" disabled={!relay.host.trim()}>Use this relay</button></div>
          </form>
        )}
        <div className="spread" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1, minWidth: 220 }} aria-label="Send a test email to" placeholder="Send a test email to… (e.g. your personal address)" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn" onClick={sendTest} disabled={!testTo.trim() || busy === 'test'}>{busy === 'test' ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Send test</button>
        </div>
        {test && test.map((d) => (
          <div key={d.to} className={`did ${d.status === 'failed' ? 'failed' : ''}`}>{d.status === 'failed' ? <X size={13} /> : <Check size={13} />} {d.to}: {d.status === 'failed' ? d.detail : d.status === 'relayed' ? 'handed to the relay' : d.status === 'sent' ? 'accepted by their mail server' : 'delivered'}</div>
        ))}
      </section>
      {onboarding && <p className="muted small">You can do this later in Settings → Domain and mail.</p>}
      {toast}
    </div>
  );
}
