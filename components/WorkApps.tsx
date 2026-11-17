'use client';

import { Check, Copy, Download, Loader2, Mail, PenLine, Plus, Send, Sparkles, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { initials, money, rpc } from '@/lib/client';
import { Field, Modal, useToast } from './ui';

const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Contacts ----------
type Person = { id: string; name: string; email: string; role?: string; company?: string; phone?: string; notes?: string };

export function ContactsApp() {
  const [team, setTeam] = useState<Person[]>([]);
  const [contacts, setContacts] = useState<Person[]>([]);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Person | null>(null);
  const { toast, attempt } = useToast();
  const load = useCallback(() => {
    rpc<Person[]>('contacts.team').then(setTeam).catch(() => {});
    rpc<Person[]>('crm.contacts').then(setContacts).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const match = (p: Person) => `${p.name} ${p.email} ${p.company ?? ''} ${p.phone ?? ''}`.toLowerCase().includes(q.trim().toLowerCase());
  const save = async () => { if (await attempt(() => rpc('crm.saveContact', edit), 'Saved.')) { setEdit(null); load(); } };
  const remove = async () => {
    if (window.confirm(`Delete ${edit!.name}? Their deals stay, without a contact.`) && (await attempt(() => rpc('crm.removeContact', { id: edit!.id }), 'Deleted.'))) { setEdit(null); load(); }
  };
  const vcard = () => download('contacts.vcf', [...team, ...contacts].map((p) =>
    ['BEGIN:VCARD', 'VERSION:3.0', `FN:${p.name}`, p.email && `EMAIL:${p.email}`, p.phone && `TEL:${p.phone}`, p.company && `ORG:${p.company}`, 'END:VCARD'].filter(Boolean).join('\r\n')).join('\r\n'), 'text/vcard');
  const list = (title: string, people: Person[], editable: boolean) => (
    <>
      <h2 className="section">{title} <span className="muted">{people.length}</span></h2>
      {people.length === 0 ? <p className="muted">{q ? 'No matches.' : 'Nobody here yet.'}</p> : (
        <div className="people">
          {people.map((p) => (
            <div key={p.id} className="card person">
              <span className="avatar">{initials(p.name)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong>{p.name}</strong>
                <small className="muted">{[p.company, p.role === 'admin' ? 'Admin' : '', p.phone].filter(Boolean).join(' · ') || ' '}</small>
                <small className="muted">{p.email || 'No email'}</small>
              </div>
              {p.email && <a className="btn ghost icon" href={`/mail?to=${encodeURIComponent(p.email)}`} title={`Email ${p.name}`} aria-label={`Email ${p.name}`}><Mail size={15} /></a>}
              {editable && <button className="btn ghost icon" title="Edit" aria-label={`Edit ${p.name}`} onClick={() => setEdit(p)}><PenLine size={15} /></button>}
            </div>
          ))}
        </div>
      )}
    </>
  );
  return (
    <div className="app">
      <div className="bar">
        <input className="input" style={{ maxWidth: 280 }} aria-label="Search contacts" placeholder="Search by name, email or company…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={vcard}><Download size={15} /> Export .vcf</button>
        <button className="btn primary" onClick={() => setEdit({ id: '', name: '', email: '', company: '', phone: '', notes: '' })}><Plus size={15} /> New contact</button>
      </div>
      <div className="body">
        {list('Team', team.filter(match), false)}
        {list('Customers and suppliers', contacts.filter(match), true)}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit contact' : 'New contact'} onClose={() => setEdit(null)}>
          <Field label="Name"><input className="input" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="two">
            <Field label="Email"><input className="input" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          </div>
          <Field label="Company"><input className="input" value={edit.company ?? ''} onChange={(e) => setEdit({ ...edit, company: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="input" style={{ height: 70, padding: 8 }} value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <div className="modal-foot">
            {edit.id && <button className="btn ghost" onClick={remove}><Trash2 size={14} /> Delete</button>}
            <button className="btn primary" onClick={save}>Save</button>
          </div>
        </Modal>
      )}
      {toast}
    </div>
  );
}

// ---------- Projects ----------
type Project = { id: string; name: string; description: string; total: number; open: number };
type Task = { id: string; project_id: string; project: string; title: string; notes: string; status: string; assignee_id: string | null; assignee: string | null; due_at: number | null };
const COLUMNS: [string, string][] = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];
const dateInput = (ts: number | null) => (ts ? new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');

export function ProjectsApp() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [at, setAt] = useState('');   // a project id, or 'mine'
  const [tasks, setTasks] = useState<Task[]>([]);
  const [task, setTask] = useState<(Partial<Task> & { due: string }) | null>(null);
  const [project, setProject] = useState<{ id?: string; name: string; description: string } | null>(null);
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState('');
  const { toast, attempt } = useToast();
  const current = projects?.find((p) => p.id === at);

  const load = useCallback(async (to?: string) => {
    const data = await rpc<{ projects: Project[]; people: { id: string; name: string }[] }>('projects.list').catch(() => null);
    if (!data) return;
    setProjects(data.projects); setPeople(data.people);
    const next = to ?? (at === 'mine' || data.projects.some((p) => p.id === at) ? at : data.projects[0]?.id ?? '');
    setAt(next);
    setTasks(next ? await rpc<Task[]>('projects.tasks', next === 'mine' ? { mine: true } : { project_id: next }).catch(() => []) : []);
  }, [at]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: string, args: unknown, done?: string) => { const ok = await attempt(() => rpc(fn, args), done); if (ok) await load(); return ok; };
  const saveTask = async () => {
    const { due, ...t } = task!;
    if (await act('projects.saveTask', { ...t, project_id: t.project_id ?? at, due_at: due ? new Date(`${due}T12:00`).getTime() : null })) setTask(null);
  };
  const saveProject = async () => {
    let id = project!.id;
    if (await attempt(async () => { id = (await rpc<{ id: string }>('projects.save', project)).id; })) { setProject(null); load(id); }
  };
  const plan = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await act('projects.aiPlan', { project_id: at, goal }, 'Tasks added.')) setGoal('');
    setBusy(false);
  };
  const addQuick = async (e: React.FormEvent) => { e.preventDefault(); if (quick.trim() && (await act('projects.saveTask', { project_id: at, title: quick }))) setQuick(''); };

  return (
    <div className="app">
      <div className="bar">
        <select className="tool-select" aria-label="Project" value={at} onChange={(e) => load(e.target.value)}>
          {projects?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.open} open)</option>)}
          <option value="mine">My tasks, all projects</option>
        </select>
        {current && <button className="btn ghost" onClick={() => setProject({ id: current.id, name: current.name, description: current.description })}>Edit project</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => setProject({ name: '', description: '' })}><Plus size={15} /> New project</button>
        {current && <button className="btn primary" onClick={() => setTask({ status: 'todo', title: '', notes: '', assignee_id: '', due: '' })}><Plus size={15} /> New task</button>}
      </div>
      {current && (
        <form className="ai-row" onSubmit={plan}>
          <input className="input" aria-label="Goal to plan" placeholder="Describe a goal and AI will break it into tasks, e.g. “launch the new website”…" value={goal} onChange={(e) => setGoal(e.target.value)} />
          <button className="btn" disabled={busy || !goal.trim()}>{busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {busy ? 'Planning…' : 'Plan it'}</button>
        </form>
      )}
      <div className="body">
        {projects?.length === 0 && at !== 'mine' ? <div className="empty">No projects yet. Create one to start adding tasks.</div> : (
          <>
            {current?.description && <p className="muted" style={{ marginTop: 0 }}>{current.description}</p>}
            <div className="board">
              {COLUMNS.map(([status, label]) => {
                const list = tasks.filter((t) => t.status === status);
                return (
                  <div key={status} className="board-col" onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { const id = e.dataTransfer.getData('text/plain'); if (id) act('projects.saveTask', { id, status }); }}>
                    <h3>{label} <span>{list.length}</span></h3>
                    {list.map((t) => {
                      const late = t.due_at && t.status !== 'done' && t.due_at < Date.now();
                      return (
                        <div key={t.id} className="card task" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)} role="button" tabIndex={0}
                          onClick={() => setTask({ ...t, assignee_id: t.assignee_id ?? '', due: dateInput(t.due_at) })} onKeyDown={(e) => e.key === 'Enter' && setTask({ ...t, assignee_id: t.assignee_id ?? '', due: dateInput(t.due_at) })}>
                          <div style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined }}>{t.title}</div>
                          <div className="task-meta">
                            {at === 'mine' && <span className="badge">{t.project}</span>}
                            {t.due_at && <span className="badge" style={late ? { color: 'var(--danger, #c0392b)', borderColor: 'currentColor' } : undefined}>{late ? 'Late · ' : ''}{day(t.due_at)}</span>}
                            <span style={{ flex: 1 }} />
                            {t.status !== 'done' && <button className="btn ghost icon" title="Mark as done" aria-label={`Mark "${t.title}" as done`} onClick={(e) => { e.stopPropagation(); act('projects.saveTask', { id: t.id, status: 'done' }); }}><Check size={14} /></button>}
                            {t.assignee && <span className="avatar" title={t.assignee} style={{ width: 22, height: 22, fontSize: 10 }}>{initials(t.assignee)}</span>}
                          </div>
                        </div>
                      );
                    })}
                    {status === 'todo' && current && (
                      <form onSubmit={addQuick}><input className="input" aria-label="Add a task" placeholder="+ Add a task and press Enter" value={quick} onChange={(e) => setQuick(e.target.value)} /></form>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {task && (
        <Modal title={task.id ? 'Task' : 'New task'} onClose={() => setTask(null)}>
          <Field label="What needs doing?"><input className="input" autoFocus value={task.title ?? ''} onChange={(e) => setTask({ ...task, title: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="input" style={{ height: 80, padding: 8 }} value={task.notes ?? ''} onChange={(e) => setTask({ ...task, notes: e.target.value })} /></Field>
          <div className="two">
            <Field label="Who">
              <select className="input" value={task.assignee_id ?? ''} onChange={(e) => setTask({ ...task, assignee_id: e.target.value })}>
                <option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Due"><input className="input" type="date" value={task.due} onChange={(e) => setTask({ ...task, due: e.target.value })} /></Field>
          </div>
          <Field label="Status">
            <select className="input" value={task.status} onChange={(e) => setTask({ ...task, status: e.target.value })}>{COLUMNS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Field>
          <div className="modal-foot">
            {task.id && <button className="btn ghost" onClick={async () => { if (await act('projects.removeTask', { id: task.id }, 'Deleted.')) setTask(null); }}><Trash2 size={14} /> Delete</button>}
            <button className="btn primary" onClick={saveTask}>Save</button>
          </div>
        </Modal>
      )}
      {project && (
        <Modal title={project.id ? 'Edit project' : 'New project'} onClose={() => setProject(null)}>
          <Field label="Name"><input className="input" autoFocus value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} /></Field>
          <Field label="What is it for?"><textarea className="input" style={{ height: 70, padding: 8 }} value={project.description} onChange={(e) => setProject({ ...project, description: e.target.value })} /></Field>
          <div className="modal-foot">
            {project.id && <button className="btn ghost" onClick={async () => { if (window.confirm(`Delete "${project.name}" and all its tasks? This cannot be undone.`) && (await act('projects.remove', { id: project.id }, 'Deleted.'))) setProject(null); }}><Trash2 size={14} /> Delete project</button>}
            <button className="btn primary" onClick={saveProject}>Save</button>
          </div>
        </Modal>
      )}
      {toast}
    </div>
  );
}

// ---------- Tax ----------
type Period = { period: string; filed_at: number | null; vatDue: number };
type Return = {
  period: string; currency: string; salesNet: number; purchasesNet: number; vatCharged: number; vatPaid: number; vatDue: number;
  rates: { rate: number; net: number; vat: number }[];
  sales: { number: string; customer: string; date: number; rate: number; net: number; vat: number }[];
  purchases: { vendor: string; description: string; date: number; net: number; vat: number }[];
  filed: { at: number; by: string; vatDue: number } | null;
};
const label = (p: string) => p.replace(/(\d+)-Q(\d)/, 'Q$2 $1');

export function TaxApp() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [period, setPeriod] = useState('');
  const [r, setR] = useState<Return | null>(null);
  const { toast, attempt } = useToast();
  const load = useCallback(async (p?: string) => {
    const data = await rpc<{ periods: Period[] }>('tax.periods').catch(() => null);
    if (!data) return;
    setPeriods(data.periods);
    const next = p ?? data.periods[0]?.period ?? '';
    setPeriod(next);
    if (next) setR(await rpc<Return>('tax.return', { period: next }).catch(() => null));
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: string, done: string) => { if (await attempt(() => rpc(fn, { period }), done)) load(period); };
  const csv = () => {
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
    const rows: (string | number)[][] = [['Type', 'Date', 'Reference', 'Party', 'VAT rate %', 'Net', 'VAT'],
      ...r!.sales.map((s) => ['Sale', new Date(s.date).toISOString().slice(0, 10), s.number, s.customer, s.rate, s.net, s.vat]),
      ...r!.purchases.map((p) => ['Purchase', new Date(p.date).toISOString().slice(0, 10), p.description, p.vendor, '', p.net, p.vat]),
      [], ['VAT charged', '', '', '', '', r!.salesNet, r!.vatCharged], ['VAT paid', '', '', '', '', r!.purchasesNet, r!.vatPaid], ['VAT due', '', '', '', '', '', r!.vatDue]];
    download(`vat-return-${r!.period}.csv`, rows.map((row) => row.map(cell).join(',')).join('\r\n'), 'text/csv');
  };
  const cur = r?.currency ?? 'EUR';
  return (
    <div className="app">
      <div className="bar">
        <select className="tool-select" aria-label="Quarter" value={period} onChange={(e) => load(e.target.value)}>
          {periods.map((p) => <option key={p.period} value={p.period}>{label(p.period)}{p.filed_at ? ' — filed' : ''}</option>)}
        </select>
        {r?.filed && <span className="badge good">Filed {day(r.filed.at)} by {r.filed.by}</span>}
        <span style={{ flex: 1 }} />
        {r && <button className="btn" onClick={csv}><Download size={15} /> Download CSV</button>}
        {r && (r.filed
          ? <button className="btn" onClick={() => act('tax.unfile', 'Reopened.')}>Reopen</button>
          : <button className="btn primary" onClick={() => act('tax.file', 'Marked as filed.')}><Check size={15} /> Mark as filed</button>)}
      </div>
      <div className="body">
        {r && (
          <>
            <div className="stats">
              {([['VAT charged on sales', r.vatCharged], ['VAT paid on purchases', r.vatPaid], [r.vatDue >= 0 ? 'VAT to pay' : 'VAT to reclaim', Math.abs(r.vatDue)]] as const).map(([l, v]) => (
                <div key={l} className="card"><div className="stat-label">{l}</div><div className="stat-value">{money(v, cur)}</div></div>
              ))}
            </div>
            {r.filed && r.filed.vatDue !== r.vatDue && <p className="notice">The figures changed after this return was filed: it was filed with {money(r.filed.vatDue, cur)}, and is now {money(r.vatDue, cur)}. You may need to send a correction.</p>}
            <h2 className="section">Sales by VAT rate</h2>
            {r.rates.length ? (
              <table className="table" style={{ maxWidth: 560 }}>
                <thead><tr><th>Rate</th><th className="num">Sales excl. VAT</th><th className="num">VAT</th></tr></thead>
                <tbody>{r.rates.map((x) => <tr key={x.rate}><td>{x.rate}%</td><td className="num">{money(x.net, cur)}</td><td className="num">{money(x.vat, cur)}</td></tr>)}</tbody>
              </table>
            ) : <p className="muted">No invoices were sent in this quarter.</p>}
            <h2 className="section">Invoices counted <span className="muted">{r.sales.length}</span></h2>
            {r.sales.length > 0 && (
              <table className="table">
                <thead><tr><th>Date</th><th>Number</th><th>Customer</th><th className="num">Net</th><th className="num">VAT</th></tr></thead>
                <tbody>{r.sales.map((s) => <tr key={s.number}><td className="muted">{day(s.date)}</td><td className="mono">{s.number}</td><td>{s.customer}</td><td className="num">{money(s.net, cur)}</td><td className="num">{money(s.vat, cur)}</td></tr>)}</tbody>
              </table>
            )}
            <h2 className="section">Expenses counted <span className="muted">{r.purchases.length}</span></h2>
            {r.purchases.length > 0 && (
              <table className="table">
                <thead><tr><th>Date</th><th>Paid to</th><th>For</th><th className="num">Net</th><th className="num">VAT</th></tr></thead>
                <tbody>{r.purchases.map((p, i) => <tr key={i}><td className="muted">{day(p.date)}</td><td>{p.vendor}</td><td className="muted">{p.description}</td><td className="num">{money(p.net, cur)}</td><td className="num">{money(p.vat, cur)}</td></tr>)}</tbody>
              </table>
            )}
            <p className="muted" style={{ marginTop: 16, fontSize: 12 }}>These are working figures from Accounting, by invoice date. databag does not send anything to a tax office: copy the figures into your tax portal, or give the CSV to your accountant. Draft invoices are not counted.</p>
          </>
        )}
      </div>
      {toast}
    </div>
  );
}

// ---------- Sign ----------
type SignDoc = { id: string; name: string; status: string; created_at: number; mine: boolean; sha256: string; signers: { name: string; email: string; signed_at: number | null; link: string | null }[] };

export function SignApp() {
  const [docs, setDocs] = useState<SignDoc[] | null>(null);
  const [ask, setAsk] = useState<{ doc: SignDoc; signers: { name: string; email: string }[]; message: string } | null>(null);
  const [self, setSelf] = useState<{ doc: SignDoc; name: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { toast, notify, attempt } = useToast();
  const load = useCallback(() => rpc<SignDoc[]>('sign.list').then(setDocs).catch(() => setDocs([])), []);
  useEffect(() => { load(); }, [load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    await attempt(async () => {
      const res = await fetch('/api/sign/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    }, 'Uploaded. Now sign it yourself or ask someone to sign.');
    if (picker.current) picker.current.value = '';
    load();
  };
  const copy = (link: string) => navigator.clipboard.writeText(location.origin + link).then(() => notify('Signing link copied.'), () => notify(location.origin + link));
  const send = async () => {
    const ok = await attempt(async () => {
      const { results } = await rpc<{ results: { name: string; emailed: boolean }[] }>('sign.request', { id: ask!.doc.id, signers: ask!.signers, message: ask!.message });
      const missed = results.filter((x) => !x.emailed).map((x) => x.name);
      notify(missed.length ? `Links created. The email to ${missed.join(', ')} could not be delivered — copy their link and send it yourself.` : 'Sent. Each signer got an email with their link.');
    });
    if (ok) { setAsk(null); load(); }
  };
  const signSelf = async () => { if (await attempt(() => rpc('sign.signSelf', { id: self!.doc.id, name: self!.name }), 'Signed.')) { setSelf(null); load(); } };
  const setSigner = (i: number, k: 'name' | 'email', v: string) => setAsk({ ...ask!, signers: ask!.signers.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });

  return (
    <div className="app">
      <div className="bar">
        <span style={{ flex: 1 }} />
        <input ref={picker} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => upload(e.target.files?.[0])} />
        <button className="btn primary" onClick={() => picker.current?.click()}><Upload size={15} /> Upload a PDF to sign</button>
      </div>
      <div className="body">
        {docs?.length === 0 && <div className="empty">Nothing to sign yet. Upload a PDF such as a contract, an offer or an NDA.</div>}
        {docs?.map((d) => (
          <div key={d.id} className="card sign-doc">
            <div className="sign-head">
              <strong>{d.name}</strong>
              <span className={`badge ${d.status === 'completed' ? 'good' : d.status === 'sent' ? 'info' : ''}`}>{d.status === 'completed' ? 'Signed by everyone' : d.status === 'sent' ? 'Waiting for signatures' : 'Not sent yet'}</span>
              <small className="muted">{d.mine ? 'Uploaded' : 'Sent to you'} {day(d.created_at)}</small>
              <span style={{ flex: 1 }} />
              <a className="btn ghost" href={`/api/sign/${d.id}`}><Download size={14} /> Original</a>
              {d.status === 'completed' && <a className="btn" href={`/api/sign/${d.id}?signed=1`}><Download size={14} /> Signed copy</a>}
              {d.mine && d.status !== 'completed' && !d.signers.some((s) => !s.signed_at && s.link && !d.mine) && <button className="btn" onClick={() => setSelf({ doc: d, name: '' })}><PenLine size={14} /> Sign it myself</button>}
              {d.mine && d.status !== 'completed' && <button className="btn primary" onClick={() => setAsk({ doc: d, signers: [{ name: '', email: '' }], message: '' })}><Send size={14} /> Ask someone to sign</button>}
              {d.mine && <button className="btn ghost icon" aria-label={`Delete ${d.name}`} onClick={async () => { if (window.confirm(`Delete "${d.name}" and its signatures? This cannot be undone.`) && (await attempt(() => rpc('sign.remove', { id: d.id }), 'Deleted.'))) load(); }}><Trash2 size={15} /></button>}
            </div>
            {d.signers.map((s, i) => (
              <div key={i} className="row">
                <span className="avatar">{initials(s.name)}</span>
                <span className="grow">{s.name} <span className="muted">· {s.email}</span></span>
                {s.signed_at ? <span className="badge good">Signed {day(s.signed_at)}</span> : <span className="badge">Not signed yet</span>}
                {!s.signed_at && s.link && (d.mine
                  ? <button className="btn ghost" onClick={() => copy(s.link!)}><Copy size={14} /> Copy link</button>
                  : <a className="btn primary" href={s.link}>Read and sign</a>)}
              </div>
            ))}
          </div>
        ))}
      </div>
      {ask && (
        <Modal title={`Ask someone to sign “${ask.doc.name}”`} wide onClose={() => setAsk(null)}>
          <span className="label">Who needs to sign?</span>
          {ask.signers.map((s, i) => (
            <div key={i} className="two" style={{ marginBottom: 8 }}>
              <input className="input" placeholder="Full name" aria-label="Signer name" value={s.name} onChange={(e) => setSigner(i, 'name', e.target.value)} />
              <input className="input" type="email" placeholder="Email address" aria-label="Signer email" value={s.email} onChange={(e) => setSigner(i, 'email', e.target.value)} />
            </div>
          ))}
          <button className="btn ghost" onClick={() => setAsk({ ...ask, signers: [...ask.signers, { name: '', email: '' }] })}><Plus size={14} /> Add another signer</button>
          <Field label="Message (optional)"><textarea className="input" style={{ height: 70, padding: 8 }} value={ask.message} onChange={(e) => setAsk({ ...ask, message: e.target.value })} /></Field>
          <p className="muted" style={{ fontSize: 12 }}>Each person gets an email from Mail with a private link. Anyone holding the link can sign as that person, so send it only to them.</p>
          <div className="modal-foot"><button className="btn primary" onClick={send}><Send size={14} /> Send for signature</button></div>
        </Modal>
      )}
      {self && (
        <Modal title={`Sign “${self.doc.name}”`} onClose={() => setSelf(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Read the document first: <a href={`/api/sign/${self.doc.id}`}>download it</a>.</p>
          <Field label="Type your full name to sign"><input className="input sign-name" autoFocus value={self.name} onChange={(e) => setSelf({ ...self, name: e.target.value })} /></Field>
          <div className="modal-foot"><button className="btn primary" disabled={self.name.trim().length < 2} onClick={signSelf}><PenLine size={14} /> Sign</button></div>
        </Modal>
      )}
      {toast}
    </div>
  );
}
