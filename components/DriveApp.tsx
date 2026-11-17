'use client';

import { Download, FileText, Presentation, Search, Table, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc, when } from '@/lib/client';
import { useToast } from './ui';

type DriveFile = { id: string; name: string; size: number; created_at: number; owner: string };
type Office = { id: string; kind: 'doc' | 'sheet' | 'deck'; title: string; updated_at: number; owner: string };
const OFFICE = { doc: { app: 'docs', icon: FileText, label: 'Document' }, sheet: { app: 'sheets', icon: Table, label: 'Spreadsheet' }, deck: { app: 'slides', icon: Presentation, label: 'Presentation' } };
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function DriveApp() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [office, setOffice] = useState<Office[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { toast, attempt } = useToast();

  const load = useCallback(() => {
    rpc<DriveFile[]>('drive.list', { q }).then(setFiles).catch(() => {});
    rpc<Office[]>('office.list', {}).then(setOffice).catch(() => {});
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    const form = new FormData();
    for (const f of list) form.append('file', f);
    await attempt(async () => {
      const res = await fetch('/api/drive/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error((await res.json()).error);
    }, list.length === 1 ? 'Uploaded.' : `${list.length} files uploaded.`);
    setBusy(false);
    if (input.current) input.current.value = '';
    load();
  };
  const remove = async (f: DriveFile) => {
    if (window.confirm(`Delete "${f.name}"? This cannot be undone.`) && (await attempt(() => rpc('drive.remove', { id: f.id }), 'Deleted.'))) load();
  };
  const shownOffice = office.filter((o) => o.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
      <div className="bar">
        <span className="grow-gap" />
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-subtle)' }} />
          <input className="input" style={{ paddingLeft: 32, height: 32, width: 220 }} placeholder="Search files" aria-label="Search files" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
        <button className="btn primary" disabled={busy} onClick={() => input.current?.click()}><Upload size={15} /> {busy ? 'Uploading…' : 'Upload'}</button>
      </div>
      <div className="body">
        {!files.length && !shownOffice.length && <div className="empty">{q ? `Nothing matches “${q}”.` : 'No files yet. Upload some, or drop them anywhere on this page.'}</div>}
        {(files.length > 0 || shownOffice.length > 0) && (
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th>Owner</th><th>Changed</th><th /></tr></thead>
            <tbody>
              {shownOffice.map((o) => {
                const m = OFFICE[o.kind];
                return (
                  <tr key={o.id} className="click" onClick={() => (window.location.href = `/${m.app}?id=${o.id}`)}>
                    <td><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><m.icon size={15} /> {o.title}</span></td>
                    <td className="muted">{m.label}</td><td className="muted">{o.owner}</td><td className="muted">{when(o.updated_at)}</td><td />
                  </tr>
                );
              })}
              {files.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td><td className="muted">{size(f.size)}</td><td className="muted">{f.owner}</td><td className="muted">{when(f.created_at)}</td>
                  <td className="acts">
                    <a className="btn ghost icon" href={`/api/drive/${f.id}`} aria-label={`Download ${f.name}`} title="Download"><Download size={15} /></a>
                    <button className="btn ghost icon" onClick={() => remove(f)} aria-label={`Delete ${f.name}`} title="Delete"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {toast}
    </div>
  );
}
