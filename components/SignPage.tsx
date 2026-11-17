'use client';

import { Check, PenLine } from 'lucide-react';
import { useState } from 'react';

type Props = { token: string; doc: string; from: string; company: string; signer: string; signedAt: number | null };

/** What a signer sees: the PDF, and a box to type their name. */
export function SignPage({ token, doc, from, company, signer, signedAt }: Props) {
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(!!signedAt);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/sign/public/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, agree }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDone(true);
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  };

  return (
    <main className="sign-public">
      <header>
        <h1>{doc}</h1>
        <p className="muted">{from} from {company} asks {signer} to sign this document.</p>
      </header>
      <iframe src={`/api/sign/public/${token}/file`} title={doc} />
      <p className="muted" style={{ fontSize: 12 }}>Can’t see the document? <a href={`/api/sign/public/${token}/file`} target="_blank" rel="noreferrer">Open it in a new tab</a>.</p>
      {done ? (
        <div className="card sign-box"><Check size={18} /> <strong>You have signed this document.</strong> <span className="muted">{from} has been told. You can close this page.</span></div>
      ) : (
        <form className="card sign-box" onSubmit={submit}>
          <label className="field" style={{ flex: 1, minWidth: 220 }}>
            <span className="label">Type your full name to sign</span>
            <input className="input sign-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="sign-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I have read the document and agree that typing my name signs it.</label>
          <button className="btn primary" disabled={busy || !agree || name.trim().length < 2}><PenLine size={15} /> {busy ? 'Signing…' : 'Sign document'}</button>
          {error && <p role="alert" style={{ color: 'var(--danger, #c0392b)', width: '100%', margin: 0 }}>{error}</p>}
        </form>
      )}
    </main>
  );
}
