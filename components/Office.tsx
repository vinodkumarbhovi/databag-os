'use client';

import {
  AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowUp, Bold, ChartColumn, Check, Download, Heading1, Heading2, History, ImagePlus, Italic,
  Link, List, ListOrdered, Loader2, MessageSquare, Play, Plus, Sparkles, Table, Trash2, Underline, Upload, Users, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { param, rpc, when } from '@/lib/client';
import { type Chart, type Format, type Sheet, type Value, colName, createEvaluator, display, parseBook, parseRef, rangeRefs } from '@/lib/formula';
import { Modal, useToast } from './ui';

type Kind = 'doc' | 'sheet' | 'deck';
type Listed = { id: string; title: string; updated_at: number; owner: string };
type OfficeFile = { id: string; kind: Kind; title: string; content: string; rev: number };
type Patch = { title?: string; content?: string };
type EditorProps = { file: OfficeFile; onChange: (content: string) => void; notify: (t: string) => void };
const META: Record<Kind, { app: string; name: string; one: string; ext: string }> = {
  doc: { app: 'docs', name: 'Docs', one: 'document', ext: '.docx' },
  sheet: { app: 'sheets', name: 'Sheets', one: 'spreadsheet', ext: '.xlsx' },
  deck: { app: 'slides', name: 'Slides', one: 'presentation', ext: '.pptx' },
};
const MAX_IMAGE = 1.5 * 1024 * 1024;

/** Read a picked image as a data URL, refusing anything too large to store in the file. */
function readImage(picked: File | undefined, notify: (t: string) => void, types = /^image\//): Promise<string | null> {
  return new Promise((resolve) => {
    if (!picked) return resolve(null);
    if (!types.test(picked.type)) { notify('That kind of picture is not supported here.'); return resolve(null); }
    if (picked.size > MAX_IMAGE) { notify('That picture is larger than 1.5 MB. Choose a smaller one.'); return resolve(null); }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(picked);
  });
}

/** List, create, import, autosave, live refresh, comments, history and export — shared by Docs, Sheets and Slides. */
function OfficeApp({ kind, Editor }: { kind: Kind; Editor: (p: EditorProps) => React.ReactNode }) {
  const meta = META[kind];
  const [files, setFiles] = useState<Listed[] | null>(null);
  const [file, setFile] = useState<OfficeFile | null>(null);
  const [epoch, setEpoch] = useState(0); // bumps whenever the editor must reload from `file`
  const [saved, setSaved] = useState(true);
  const [others, setOthers] = useState<string[]>([]);
  const [openComments, setOpenComments] = useState(0);
  const [conflict, setConflict] = useState('');
  const [panel, setPanel] = useState<null | 'comments' | 'history'>(null);
  const [quote, setQuote] = useState('');
  const rev = useRef(0);
  const pending = useRef<Patch>({});
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const { toast, notify, attempt } = useToast();
  const fileId = file?.id;

  const load = useCallback(() => rpc<Listed[]>('office.list', { kind }).then(setFiles).catch(() => setFiles([])), [kind]);
  const adopt = useCallback((f: OfficeFile) => {
    clearTimeout(timer.current);
    pending.current = {};
    rev.current = f.rev;
    setFile(f); setEpoch((n) => n + 1); setSaved(true); setConflict('');
  }, []);
  const open = useCallback((id: string) => attempt(async () => {
    adopt(await rpc<OfficeFile>('office.get', { id }));
    history.replaceState(null, '', `/${meta.app}?id=${id}`);
  }), [attempt, adopt, meta.app]);
  useEffect(() => {
    load();
    const id = param('id');
    if (id) open(id);
  }, [load, open]);

  const flush = useCallback(async (force = false) => {
    clearTimeout(timer.current);
    if (!fileId || saving.current || !Object.keys(pending.current).length) return;
    const patch = pending.current;
    pending.current = {};
    saving.current = true;
    try {
      const res = await rpc<{ rev: number; conflict?: boolean; by?: string }>('office.save', { id: fileId, ...patch, rev: rev.current, force });
      if (res.conflict) { pending.current = { ...patch, ...pending.current }; setConflict(res.by ?? 'Someone'); }
      else {
        rev.current = res.rev;
        if (Object.keys(pending.current).length) timer.current = setTimeout(() => flush(), 800); else setSaved(true);
      }
    } catch (err) { pending.current = { ...patch, ...pending.current }; notify(`Not saved: ${(err as Error).message}`); }
    finally { saving.current = false; }
  }, [fileId, notify]);
  const queue = (patch: Patch) => {
    pending.current = { ...pending.current, ...patch };
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), 800);
  };

  // Every few seconds: who else is here, and has anyone saved a newer copy?
  useEffect(() => {
    if (!fileId) return;
    const tick = async () => {
      try {
        const res = await rpc<{ editors: string[]; file: (OfficeFile & { by: string }) | null; comments: number }>('office.sync', { id: fileId, rev: rev.current });
        setOthers(res.editors);
        setOpenComments(res.comments);
        if (res.file && res.file.rev > rev.current && !saving.current && !Object.keys(pending.current).length) {
          adopt(res.file);
          notify(`${res.file.by} made changes. You are now seeing the latest copy.`);
        }
      } catch { /* try again on the next tick */ }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [fileId, adopt, notify]);

  const create = () => attempt(async () => open((await rpc<{ id: string }>('office.create', { kind })).id));
  const close = async () => { await flush(); setFile(null); setOthers([]); history.replaceState(null, '', `/${meta.app}`); load(); };
  const reload = () => attempt(async () => adopt(await rpc<OfficeFile>('office.get', { id: fileId })));
  const remove = async (f: Listed) => {
    if (window.confirm(`Delete "${f.title}"? This cannot be undone.`) && (await attempt(() => rpc('office.remove', { id: f.id }), 'Deleted.'))) load();
  };
  const importFile = async (picked: File | undefined) => {
    if (!picked) return;
    const form = new FormData();
    form.append('file', picked);
    await attempt(async () => {
      const res = await fetch('/api/office/import', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await open(data.id);
    });
    if (fileInput.current) fileInput.current.value = '';
  };
  const exportFile = async () => { await flush(); window.location.href = `/api/office/${file!.id}/export`; };

  if (file)
    return (
      <div className="app">
        <div className="bar">
          <button className="btn ghost icon" onClick={close} aria-label="Back to all files"><ArrowLeft size={16} /></button>
          <input key={epoch} className="title-input" aria-label="Title" defaultValue={file.title} onChange={(e) => queue({ title: e.target.value })} />
          {others.length > 0 && <span className="badge info" title="Their saved changes appear here automatically"><Users size={11} /> {others.join(', ')} also here</span>}
          <span className="muted mono">{conflict ? 'Not saved' : saved ? 'Saved' : 'Saving…'}</span>
          <button className="btn" onMouseDown={() => setQuote(window.getSelection()?.toString().trim() ?? '')} onClick={() => setPanel('comments')}>
            <MessageSquare size={15} /> Comments{openComments ? ` (${openComments})` : ''}
          </button>
          <button className="btn" onClick={async () => { await flush(); setPanel('history'); }}><History size={15} /> History</button>
          <button className="btn" onClick={exportFile}><Download size={15} /> Download {meta.ext}</button>
        </div>
        <Editor key={`${file.id}:${epoch}`} file={file} onChange={(content) => queue({ content })} notify={notify} />
        {panel === 'comments' && <Comments fileId={file.id} quote={quote} onClose={() => setPanel(null)} onCount={setOpenComments} />}
        {panel === 'history' && <Versions fileId={file.id} onClose={() => setPanel(null)} onRestored={() => { setPanel(null); reload(); }} />}
        {conflict && (
          <Modal title="Someone else changed this file" onClose={() => undefined}>
            <p style={{ marginTop: 0 }}>{conflict} saved changes while you were editing. Your latest changes are not saved yet.</p>
            <p className="muted">Keeping yours replaces their copy. Their copy stays in History, so nothing is lost.</p>
            <div className="modal-foot">
              <button className="btn" onClick={reload}>Load their copy</button>
              <button className="btn primary" onClick={() => { setConflict(''); flush(true); }}>Keep mine</button>
            </div>
          </Modal>
        )}
        {toast}
      </div>
    );

  return (
    <div className="app">
      <div className="bar">
        <span className="grow-gap" />
        <input ref={fileInput} type="file" accept={meta.ext} hidden onChange={(e) => importFile(e.target.files?.[0])} />
        <button className="btn" onClick={() => fileInput.current?.click()}><Upload size={15} /> Open {meta.ext} file</button>
        <button className="btn primary" onClick={create}><Plus size={15} /> New {meta.one}</button>
      </div>
      <div className="body">
        {files?.length === 0 && <div className="empty">No {meta.one}s yet.</div>}
        <div className="file-grid">
          {files?.map((f) => (
            <div key={f.id} className="card file-card" role="button" tabIndex={0} onClick={() => open(f.id)} onKeyDown={(e) => e.key === 'Enter' && open(f.id)}>
              <strong>{f.title}</strong>
              <small>{f.owner} · {when(f.updated_at)}</small>
              <button className="btn ghost icon" style={{ alignSelf: 'flex-end' }} aria-label={`Delete ${f.title}`} onClick={(e) => { e.stopPropagation(); remove(f); }}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </div>
      {toast}
    </div>
  );
}

type Comment = { id: string; quote: string; body: string; resolved: number; created_at: number; by: string };
function Comments({ fileId, quote, onClose, onCount }: { fileId: string; quote: string; onClose: () => void; onCount: (n: number) => void }) {
  const [list, setList] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const rows = await rpc<Comment[]>('office.comments', { id: fileId });
    setList(rows);
    onCount(rows.filter((c) => !c.resolved).length);
  }, [fileId, onCount]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  const act = (fn: string, args: object) => rpc(fn, args).then(load).catch((e) => setError(e.message));
  return (
    <Modal title="Comments" onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); act('office.addComment', { id: fileId, body, quote }).then(() => setBody('')); }}>
        {quote && <blockquote className="quote">{quote.slice(0, 300)}</blockquote>}
        <textarea className="input" style={{ height: 70, padding: 8 }} aria-label="New comment" placeholder={quote ? 'Comment on the selected text…' : 'Write a comment…'} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="modal-foot" style={{ margin: '8px 0 12px' }}><button className="btn primary" disabled={!body.trim()}>Add comment</button></div>
      </form>
      {error && <p className="muted">{error}</p>}
      {list.length === 0 && <div className="empty">No comments yet.</div>}
      {list.map((c) => (
        <div key={c.id} className="row" style={{ alignItems: 'flex-start', opacity: c.resolved ? 0.55 : 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <small className="muted">{c.by} · {when(c.created_at)}{c.resolved ? ' · resolved' : ''}</small>
            {c.quote && <blockquote className="quote">{c.quote}</blockquote>}
            <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
          </div>
          <button className="btn ghost" onClick={() => act('office.resolveComment', { commentId: c.id, resolved: !c.resolved })}>
            {c.resolved ? 'Reopen' : <><Check size={14} /> Resolve</>}
          </button>
        </div>
      ))}
    </Modal>
  );
}

type Version = { id: string; title: string; created_at: number; size: number; by: string };
function Versions({ fileId, onClose, onRestored }: { fileId: string; onClose: () => void; onRestored: () => void }) {
  const [list, setList] = useState<Version[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { rpc<Version[]>('office.versions', { id: fileId }).then(setList).catch((e) => setError(e.message)); }, [fileId]);
  const restore = (v: Version) => rpc('office.restore', { id: fileId, versionId: v.id }).then(onRestored).catch((e) => setError(e.message));
  return (
    <Modal title="History" onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>Earlier copies are kept as the file changes. Restoring one keeps the current copy here too.</p>
      {error && <p className="muted">{error}</p>}
      {list?.length === 0 && <div className="empty">No earlier copies yet.</div>}
      {list?.map((v) => (
        <div key={v.id} className="row">
          <span className="grow">{new Date(v.created_at).toLocaleString()} · last edited by {v.by}</span>
          <button className="btn" onClick={() => restore(v)}>Restore</button>
        </div>
      ))}
    </Modal>
  );
}

/** A prompt bar that asks the local model for something. */
function AiBar({ placeholder, label, run }: { placeholder: string; label: string; run: (instruction: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await run(text).finally(() => setBusy(false));
  };
  return (
    <form className="ai-row" onSubmit={submit}>
      <input className="input" aria-label={placeholder} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" disabled={busy || !text.trim()}>{busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {busy ? 'Working…' : label}</button>
    </form>
  );
}

/** A dropdown that performs an action and returns to its label. */
function Pick({ label, options, onPick }: { label: string; options: [string, string][]; onPick: (value: string) => void }) {
  return (
    <select className="tool-select" aria-label={label} value="" onChange={(e) => onPick(e.target.value)}>
      <option value="" disabled>{label}</option>
      {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </select>
  );
}

// ---------- Docs ----------
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Documents are shared and can come from imported files, so strip anything that could run code. */
function clean(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,style,link,meta,form,base').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes])
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && !/^(https?:|mailto:|data:image\/|#)/i.test(a.value.trim()))) el.removeAttribute(a.name);
  });
  return doc.body.innerHTML;
}

const FONTS: [string, string][] = [['Inter, system-ui, sans-serif', 'Sans'], ['Georgia, serif', 'Serif'], ['Arial, sans-serif', 'Arial'], ['"Times New Roman", serif', 'Times New Roman'], ['"Courier New", monospace', 'Monospace']];
const SIZES: [string, string][] = [['12', 'Small'], ['15', 'Normal'], ['19', 'Large'], ['26', 'Extra large'], ['36', 'Huge']];

function DocEditor({ file, onChange, notify }: EditorProps) {
  const page = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const range = useRef<Range | null>(null);
  // Set the saved content once; after that the browser owns the editable area.
  useEffect(() => { if (page.current) page.current.innerHTML = clean(file.content); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Remember where the cursor was, so toolbar controls that take focus still act on it.
  useEffect(() => {
    const remember = () => {
      const s = window.getSelection();
      if (s?.rangeCount && page.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', remember);
    return () => document.removeEventListener('selectionchange', remember);
  }, []);

  const changed = () => onChange(page.current!.innerHTML);
  const restore = () => {
    page.current?.focus();
    const s = window.getSelection();
    if (range.current && s) { s.removeAllRanges(); s.addRange(range.current); }
  };
  const format = (command: string, value?: string) => {
    restore();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
    changed();
  };
  const setSize = (px: string) => {
    restore();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('fontSize', false, '7');
    page.current!.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement('span');
      span.style.fontSize = `${px}px`;
      span.innerHTML = f.innerHTML;
      f.replaceWith(span);
    });
    changed();
  };
  const addLink = () => {
    const url = window.prompt('Link address', 'https://')?.trim();
    if (url && url !== 'https://') format('createLink', /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`);
  };
  const addTable = () => {
    const m = /^\s*(\d+)\s*[x×*,]\s*(\d+)\s*$/i.exec(window.prompt('Table size: rows x columns', '3 x 3') ?? '');
    if (!m) return;
    const rows = Math.min(40, Math.max(1, +m[1])), cols = Math.min(10, Math.max(1, +m[2]));
    format('insertHTML', `<table><tbody>${`<tr>${'<td><br></td>'.repeat(cols)}</tr>`.repeat(rows)}</tbody></table><p><br></p>`);
  };
  const addImage = async (picked: File | undefined) => {
    const src = await readImage(picked, notify, /^image\/(png|jpeg|gif)$/);
    if (src) format('insertHTML', `<img src="${src}" alt="${escapeHtml(picked!.name)}" style="max-width:100%">`);
    if (picker.current) picker.current.value = '';
  };
  const write = async (instruction: string) => {
    try {
      const selected = window.getSelection()?.toString() ?? '';
      const { text } = await rpc<{ text: string }>('office.aiWrite', { instruction, text: selected });
      const html = text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
      // With a selection the new text replaces it; otherwise it is added at the end.
      if (selected && page.current?.contains(window.getSelection()!.anchorNode)) document.execCommand('insertHTML', false, html);
      else page.current!.insertAdjacentHTML('beforeend', html);
      changed();
    } catch (err) { notify((err as Error).message); }
  };
  const tools: [string, typeof Bold, () => void][] = [
    ['Bold', Bold, () => format('bold')], ['Italic', Italic, () => format('italic')], ['Underline', Underline, () => format('underline')],
    ['Heading', Heading1, () => format('formatBlock', 'h1')], ['Subheading', Heading2, () => format('formatBlock', 'h2')],
    ['Bullet list', List, () => format('insertUnorderedList')], ['Numbered list', ListOrdered, () => format('insertOrderedList')],
    ['Align left', AlignLeft, () => format('justifyLeft')], ['Centre', AlignCenter, () => format('justifyCenter')], ['Align right', AlignRight, () => format('justifyRight')],
    ['Link', Link, addLink], ['Table', Table, addTable], ['Picture', ImagePlus, () => picker.current?.click()],
  ];
  return (
    <>
      <div className="bar tools">
        <Pick label="Font" options={FONTS} onPick={(v) => format('fontName', v)} />
        <Pick label="Size" options={SIZES} onPick={setSize} />
        <label className="swatch" title="Text colour">A<input type="color" aria-label="Text colour" defaultValue="#d6336c" onChange={(e) => format('foreColor', e.target.value)} /></label>
        <label className="swatch mark" title="Highlight">A<input type="color" aria-label="Highlight colour" defaultValue="#fff3b0" onChange={(e) => format('hiliteColor', e.target.value)} /></label>
        {tools.map(([name, Icon, action]) => (
          <button key={name} className="btn ghost icon" title={name} aria-label={name} onMouseDown={(e) => e.preventDefault()} onClick={action}><Icon size={16} /></button>
        ))}
        <button className="btn ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => format('formatBlock', 'p')}>Normal text</button>
        <button className="btn ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => format('removeFormat')}>Clear formatting</button>
        <input ref={picker} type="file" accept="image/png,image/jpeg,image/gif" hidden onChange={(e) => addImage(e.target.files?.[0])} />
      </div>
      <AiBar placeholder="Ask AI to write something, or select text and say how to change it…" label="Write" run={write} />
      <div className="body" style={{ background: 'var(--bg-subtle)' }}>
        <div ref={page} className="doc-page" contentEditable suppressContentEditableWarning role="textbox" aria-label="Document" aria-multiline onInput={changed} />
      </div>
    </>
  );
}

// ---------- Sheets ----------
const COLS = 26, ROWS = 100;
const FILLS: [string, string][] = [['', 'No fill'], ['#fff3b0', 'Yellow'], ['#c8f0d0', 'Green'], ['#ffd0cc', 'Red'], ['#cfe0ff', 'Blue'], ['#e4e4e0', 'Grey']];
const PALETTE = ['#5b5bd6', '#e5484d', '#30a46c', '#f5a524', '#0091ff', '#8e4ec6', '#12a594', '#d6409f'];

/** A chart drawn from a range: the last column holds the numbers, the first the labels. */
function ChartView({ chart, evaluate, sheet, onRemove }: { chart: Chart; evaluate: (sheet: number, ref: string) => Value; sheet: number; onRemove: () => void }) {
  const [a, b = a] = chart.range.split(':');
  const points = rangeRefs(a, b)
    .map((row, i) => ({ label: row.length > 1 ? String(evaluate(sheet, row[0])) : String(i + 1), value: evaluate(sheet, row[row.length - 1]) }))
    .filter((p): p is { label: string; value: number } => typeof p.value === 'number');
  const W = 320, H = 170, pad = 22;
  const max = Math.max(0, ...points.map((p) => p.value)), min = Math.min(0, ...points.map((p) => p.value));
  const y = (v: number) => pad / 2 + (H - pad * 1.5) * (1 - (v - min) / (max - min || 1));
  const step = (W - pad) / Math.max(1, points.length);
  const total = points.reduce((n, p) => n + Math.max(0, p.value), 0) || 1;
  let angle = -Math.PI / 2;
  return (
    <figure className="chart card">
      <figcaption><strong>{chart.title}</strong><button className="btn ghost icon" aria-label={`Remove chart ${chart.title}`} onClick={onRemove}><X size={14} /></button></figcaption>
      {points.length === 0 ? <div className="empty">No numbers in {chart.range}.</div> : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${chart.type} chart of ${chart.range}`}>
          {chart.type !== 'pie' && <line x1={pad} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" />}
          {chart.type === 'bar' && points.map((p, i) => (
            <rect key={i} x={pad + i * step + step * 0.15} width={step * 0.7} y={Math.min(y(p.value), y(0))} height={Math.abs(y(p.value) - y(0))} fill={PALETTE[0]} rx={2}><title>{p.label}: {p.value}</title></rect>
          ))}
          {chart.type === 'line' && (
            <>
              <polyline fill="none" stroke={PALETTE[0]} strokeWidth={2} points={points.map((p, i) => `${pad + i * step + step / 2},${y(p.value)}`).join(' ')} />
              {points.map((p, i) => <circle key={i} cx={pad + i * step + step / 2} cy={y(p.value)} r={3} fill={PALETTE[0]}><title>{p.label}: {p.value}</title></circle>)}
            </>
          )}
          {chart.type === 'pie' && points.filter((p) => p.value > 0).map((p, i, list) => {
            const from = angle, to = (angle += (p.value / total) * Math.PI * 2);
            const cx = 85, cy = H / 2, r = 70;
            const d = list.length === 1 ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
              : `M ${cx} ${cy} L ${cx + r * Math.cos(from)} ${cy + r * Math.sin(from)} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(to)} ${cy + r * Math.sin(to)} Z`;
            return (
              <g key={i}>
                <path d={d} fill={PALETTE[i % PALETTE.length]}><title>{p.label}: {p.value}</title></path>
                {i < 9 && <><rect x={175} y={10 + i * 17} width={9} height={9} fill={PALETTE[i % PALETTE.length]} /><text x={189} y={18 + i * 17} fontSize={10} fill="currentColor">{p.label.slice(0, 16)} ({Math.round((p.value / total) * 100)}%)</text></>}
              </g>
            );
          })}
          {chart.type !== 'pie' && points.length <= 10 && points.map((p, i) => (
            <text key={i} x={pad + i * step + step / 2} y={H - 3} fontSize={9} textAnchor="middle" fill="currentColor">{p.label.slice(0, Math.max(3, Math.floor(step / 6)))}</text>
          ))}
          {chart.type !== 'pie' && <text x={2} y={y(max) + 4} fontSize={9} fill="currentColor">{max.toLocaleString(undefined, { notation: 'compact' })}</text>}
        </svg>
      )}
    </figure>
  );
}

function SheetEditor({ file, onChange, notify }: EditorProps) {
  const [book, setBook] = useState<Sheet[]>(() => parseBook(file.content));
  const [at, setAt] = useState(0);
  const [sel, setSel] = useState('A1');
  const [end, setEnd] = useState('A1');
  const si = Math.min(at, book.length - 1);
  const sheet = book[si];
  const evaluate = useMemo(() => createEvaluator(book), [book]);
  const values = useMemo(() => {
    const out: Record<string, Value> = {};
    for (const ref of Object.keys(sheet.cells)) out[ref] = evaluate(si, ref);
    return out;
  }, [evaluate, sheet, si]);
  const picked = useMemo(() => new Set(rangeRefs(sel, end).flat()), [sel, end]);
  const format = sheet.formats?.[sel];

  const commit = (next: Sheet[]) => { setBook(next); onChange(JSON.stringify({ sheets: next })); };
  const patchSheet = (patch: Partial<Sheet>) => commit(book.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  const setCell = (ref: string, raw: string) => {
    const cells = { ...sheet.cells };
    if (raw === '') delete cells[ref]; else cells[ref] = raw;
    patchSheet({ cells });
  };
  const setFormat = (patch: Partial<Format>) => {
    const formats = { ...sheet.formats };
    for (const ref of picked) {
      const f: Format = { ...formats[ref], ...patch };
      for (const k of Object.keys(f) as (keyof Format)[]) if (!f[k]) delete f[k];
      if (Object.keys(f).length) formats[ref] = f; else delete formats[ref];
    }
    patchSheet({ formats });
  };
  const select = (ref: string, extend = false) => { if (!extend) setSel(ref); setEnd(ref); };
  const move = (dc: number, dr: number) => {
    const p = parseRef(sel);
    select(`${colName(Math.min(COLS - 1, Math.max(0, p.col + dc)))}${Math.min(ROWS, Math.max(1, p.row + dr))}`);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(0, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(0, -1); }
  };

  const addChart = (type: string) => {
    if (picked.size < 2) return notify('Select the cells to chart first: click the first cell, then shift-click the last.');
    const rows = rangeRefs(sel, end);
    const header = values[rows[0][rows[0].length - 1]];
    const range = `${rows[0][0]}:${rows[rows.length - 1].at(-1)}`;
    patchSheet({ charts: [...(sheet.charts ?? []), { id: crypto.randomUUID(), type: type as Chart['type'], range, title: typeof header === 'string' && header ? header : range }] });
  };
  const addSheet = () => {
    let n = book.length + 1;
    while (book.some((s) => s.name === `Sheet${n}`)) n++;
    commit([...book, { name: `Sheet${n}`, cells: {} }]);
    setAt(book.length);
    select('A1');
  };
  const renameSheet = () => {
    const name = window.prompt('Sheet name', sheet.name)?.replace(/[!'[\]:*?/\\]/g, '').trim().slice(0, 31);
    if (!name || name === sheet.name) return;
    if (book.some((s) => s.name.toLowerCase() === name.toLowerCase())) return notify('Another sheet already has that name.');
    patchSheet({ name });
  };
  const deleteSheet = () => {
    if (!window.confirm(`Delete the sheet "${sheet.name}" and everything on it?`)) return;
    commit(book.filter((_, i) => i !== si));
    setAt(Math.max(0, si - 1));
    select('A1');
  };

  return (
    <>
      <div className="bar tools">
        <button className={`btn ghost icon ${format?.b ? 'on' : ''}`} title="Bold" aria-label="Bold" aria-pressed={!!format?.b} onClick={() => setFormat({ b: format?.b ? undefined : 1 })}><Bold size={16} /></button>
        <button className={`btn ghost icon ${format?.i ? 'on' : ''}`} title="Italic" aria-label="Italic" aria-pressed={!!format?.i} onClick={() => setFormat({ i: format?.i ? undefined : 1 })}><Italic size={16} /></button>
        <select className="tool-select" aria-label="Number format" value={format?.fmt ?? ''} onChange={(e) => setFormat({ fmt: (e.target.value || undefined) as Format['fmt'] })}>
          <option value="">Automatic</option><option value="number">Number (1,234.50)</option><option value="currency">Currency</option><option value="percent">Percent</option><option value="date">Date</option>
        </select>
        <select className="tool-select" aria-label="Fill colour" value={format?.bg ?? ''} onChange={(e) => setFormat({ bg: e.target.value || undefined })}>
          {FILLS.map(([value, name]) => <option key={value} value={value}>{value ? `${name} fill` : name}</option>)}
        </select>
        <ChartColumn size={16} className="muted" />
        <Pick label="Insert chart" options={[['bar', 'Bar chart'], ['line', 'Line chart'], ['pie', 'Pie chart']]} onPick={addChart} />
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{picked.size > 1 ? `${picked.size} cells selected` : 'Shift-click to select a range'}</span>
      </div>
      <div className="fx">
        <span className="badge">{sel}</span>
        <input className="input" aria-label={`Contents of ${sel}`} placeholder="Type a value, or a formula like =SUM(A1:A5) or =IF(B2>100,&quot;High&quot;,&quot;Low&quot;)" value={sheet.cells[sel] ?? ''} onChange={(e) => setCell(sel, e.target.value)} onKeyDown={onKey} />
      </div>
      <div className="sheet-wrap">
        <table className="sheet">
          <thead>
            <tr><th className="rowh" />{Array.from({ length: COLS }, (_, c) => <th key={c}>{colName(c)}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, r) => (
              <tr key={r}>
                <th className="rowh">{r + 1}</th>
                {Array.from({ length: COLS }, (_, c) => {
                  const ref = `${colName(c)}${r + 1}`;
                  const f = sheet.formats?.[ref];
                  const style = f ? { fontWeight: f.b ? 700 : undefined, fontStyle: f.i ? 'italic' : undefined, background: f.bg, color: f.bg ? '#1a1a17' : undefined } : undefined;
                  if (ref === sel)
                    return (
                      <td key={ref} className="sel" style={style}>
                        <input autoFocus aria-label={ref} style={style && { ...style, background: 'none' }} value={sheet.cells[ref] ?? ''} onChange={(e) => setCell(ref, e.target.value)} onKeyDown={onKey} />
                      </td>
                    );
                  const v = values[ref] ?? '';
                  return (
                    <td key={ref} style={style} className={`${typeof v === 'number' ? 'num' : ''} ${picked.has(ref) ? 'inr' : ''}`}
                      onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); select(ref, e.shiftKey); }}
                      onMouseEnter={(e) => e.buttons === 1 && setEnd(ref)}>
                      {display(v, f, 'EUR')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!sheet.charts?.length && (
        <div className="charts">
          {sheet.charts.map((c) => <ChartView key={c.id} chart={c} evaluate={evaluate} sheet={si} onRemove={() => patchSheet({ charts: sheet.charts!.filter((x) => x.id !== c.id) })} />)}
        </div>
      )}
      <div className="sheet-tabs">
        {book.map((s, i) => (
          <button key={s.name} className={i === si ? 'on' : ''} onClick={() => { setAt(i); select('A1'); }} onDoubleClick={renameSheet} title={i === si ? 'Double-click to rename' : undefined}>{s.name}</button>
        ))}
        <button aria-label="Add sheet" title="Add sheet" onClick={addSheet}><Plus size={14} /></button>
        <span style={{ flex: 1 }} />
        <button onClick={renameSheet}>Rename</button>
        <button disabled={book.length < 2} onClick={deleteSheet}>Delete sheet</button>
      </div>
    </>
  );
}

// ---------- Slides ----------
type Slide = { title: string; body: string; notes?: string; image?: string; layout?: 'bullets' | 'title' };
type Theme = 'light' | 'dark' | 'brand';
type Deck = { theme: Theme; slides: Slide[] };
const BLANK: Slide = { title: '', body: '' };

function DeckEditor({ file, onChange, notify }: EditorProps) {
  const [deck, setDeck] = useState<Deck>(() => {
    try { const d = JSON.parse(file.content); if (d.slides?.length) return { theme: d.theme ?? 'light', slides: d.slides }; } catch { /* empty deck below */ }
    return { theme: 'light', slides: [BLANK] };
  });
  const [at, setAt] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const { slides, theme } = deck;
  const index = Math.min(at, slides.length - 1);
  const current = slides[index];
  const lines = current.body.split('\n').filter((l) => l.trim());

  const commit = (next: Deck, to = index) => { setDeck(next); setAt(Math.min(to, next.slides.length - 1)); onChange(JSON.stringify(next)); };
  const update = (next: Slide[], to = index) => commit({ theme, slides: next }, to);
  const edit = (patch: Partial<Slide>) => update(slides.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const shift = (by: number) => {
    const next = [...slides];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    update(next, index + by);
  };
  const addImage = async (picked: File | undefined) => {
    const image = await readImage(picked, notify, /^image\/(png|jpeg|gif)$/);
    if (image) edit({ image, layout: 'bullets' });
    if (picker.current) picker.current.value = '';
  };
  const generate = async (topic: string) => {
    try { update((await rpc<{ slides: Slide[] }>('office.aiDeck', { topic })).slides, 0); }
    catch (err) { notify((err as Error).message); }
  };

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresenting(false);
      else if (e.key === 'ArrowRight' || e.key === ' ') setAt((i) => Math.min(slides.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, slides.length]);

  return (
    <>
      <div className="bar tools">
        <button className="btn" onClick={() => update([...slides.slice(0, index + 1), BLANK, ...slides.slice(index + 1)], index + 1)}><Plus size={15} /> Add slide</button>
        <button className="btn ghost icon" title="Move slide up" aria-label="Move slide up" disabled={index === 0} onClick={() => shift(-1)}><ArrowUp size={16} /></button>
        <button className="btn ghost icon" title="Move slide down" aria-label="Move slide down" disabled={index === slides.length - 1} onClick={() => shift(1)}><ArrowDown size={16} /></button>
        <button className="btn ghost icon" title="Delete slide" aria-label="Delete slide" disabled={slides.length < 2} onClick={() => update(slides.filter((_, i) => i !== index), Math.max(0, index - 1))}><Trash2 size={16} /></button>
        <select className="tool-select" aria-label="Slide layout" value={current.layout ?? 'bullets'} onChange={(e) => edit({ layout: e.target.value as Slide['layout'] })}>
          <option value="bullets">Layout: title and points</option><option value="title">Layout: title slide</option>
        </select>
        <select className="tool-select" aria-label="Theme" value={theme} onChange={(e) => commit({ theme: e.target.value as Theme, slides })}>
          <option value="light">Theme: light</option><option value="dark">Theme: dark</option><option value="brand">Theme: indigo</option>
        </select>
        {current.image
          ? <button className="btn" onClick={() => edit({ image: undefined })}><X size={15} /> Remove picture</button>
          : <button className="btn" onClick={() => picker.current?.click()}><ImagePlus size={15} /> Picture</button>}
        <input ref={picker} type="file" accept="image/png,image/jpeg,image/gif" hidden onChange={(e) => addImage(e.target.files?.[0])} />
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setPresenting(true)}><Play size={15} /> Present</button>
      </div>
      <AiBar placeholder="Describe a presentation and AI will draft the slides (replaces the current ones)…" label="Draft deck" run={generate} />
      <div className="deck">
        <div className="deck-list">
          {slides.map((s, i) => (
            <button key={i} className={`thumb t-${theme} ${i === index ? 'on' : ''}`} onClick={() => setAt(i)}><strong>{i + 1}. {s.title || 'Untitled'}</strong></button>
          ))}
        </div>
        <div className="body" style={{ background: 'var(--bg-subtle)' }}>
          <div className={`slide t-${theme} l-${current.layout ?? 'bullets'}`}>
            <input aria-label="Slide title" placeholder="Slide title" value={current.title} onChange={(e) => edit({ title: e.target.value })} />
            <div className="slide-cols">
              <textarea aria-label="Slide points" placeholder={current.layout === 'title' ? 'Subtitle' : 'One point per line'} value={current.body} onChange={(e) => edit({ body: e.target.value })} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {current.image && current.layout !== 'title' && <img src={current.image} alt="" />}
            </div>
          </div>
          <textarea className="input notes" aria-label="Speaker notes" placeholder="Speaker notes — only you see these. They are saved into the .pptx file." value={current.notes ?? ''} onChange={(e) => edit({ notes: e.target.value })} />
        </div>
      </div>
      {presenting && (
        <div className={`present t-${theme} l-${current.layout ?? 'bullets'}`} onClick={() => (index < slides.length - 1 ? setAt(index + 1) : setPresenting(false))}>
          <h1>{current.title}</h1>
          <div className="slide-cols">
            {current.layout === 'title' ? <p>{lines.join(' · ')}</p> : <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {current.image && current.layout !== 'title' && <img src={current.image} alt="" />}
          </div>
          <small>{index + 1} / {slides.length} · Esc to exit</small>
        </div>
      )}
    </>
  );
}

export const DocsApp = () => <OfficeApp kind="doc" Editor={DocEditor} />;
export const SheetsApp = () => <OfficeApp kind="sheet" Editor={SheetEditor} />;
export const SlidesApp = () => <OfficeApp kind="deck" Editor={DeckEditor} />;
