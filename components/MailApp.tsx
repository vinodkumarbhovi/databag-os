'use client';

import { Archive, Inbox, Loader2, Pencil, Reply, Search, Send, Sparkles, Star, Trash2, Undo2, X, ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call, initials, param, when } from '@/lib/client';

type Delivery = { to: string; status: 'delivered' | 'relayed' | 'sent' | 'failed'; detail?: string };
type Mail = {
  id: string; folder: string; thread_id: string; from_addr: string; from_name: string; to: string[]; cc: string[];
  subject: string; body_text: string; body_html: string | null; snippet: string; is_read: boolean; is_starred: boolean;
  delivery: Delivery[] | null; ai_summary: string | null; created_at: number;
};
type Draft = { to: string; cc: string; subject: string; body: string; inReplyToId?: string };
type FolderId = 'inbox' | 'starred' | 'sent' | 'archive' | 'trash';

const FOLDERS: { id: FolderId; label: string; icon: typeof Inbox }[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];
const splitAddrs = (s: string) => s.split(/[,;\s]+/).filter(Boolean);

export function MailApp({ me }: { me: { name: string; email: string } }) {
  const [folder, setFolder] = useState<FolderId>('inbox');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Mail[] | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<{ mail: Mail; thread: Mail[] } | null>(null);
  const [summary, setSummary] = useState<{ text?: string; busy?: boolean; error?: string }>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [people, setPeople] = useState<{ name: string; email: string }[]>([]);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const notify = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  };

  const load = useCallback(async () => {
    try {
      const d = await call<{ messages: Mail[]; unread: Record<string, number> }>(`/api/mail/messages?folder=${folder}&q=${encodeURIComponent(query)}`);
      setList(d.messages);
      setUnread(d.unread);
    } catch (err) {
      notify((err as Error).message);
    }
  }, [folder, query]);

  useEffect(() => {
    setList(null);
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    call<{ users: { name: string; email: string }[] }>('/api/users').then((d) => setPeople(d.users)).catch(() => {});
    // Other apps link here with ?to=address to start an email (for example CRM's Email button).
    const to = param('to');
    if (to) setDraft({ to, cc: '', subject: '', body: '' });
    // Search links here with ?open=<message id>.
    const linked = param('open');
    if (linked) openMail(linked);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openMail = async (id: string) => {
    try {
      const d = await call<{ mail: Mail; thread: Mail[] }>(`/api/mail/messages/${id}`);
      setOpen(d);
      setSummary(d.mail.ai_summary ? { text: d.mail.ai_summary } : {});
      load();
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const patch = async (mail: Mail, body: Partial<Pick<Mail, 'is_starred' | 'is_read'>> & { folder?: string }, done?: string) => {
    await call(`/api/mail/messages/${mail.id}`, { method: 'PATCH', body });
    if (body.folder) setOpen(null);
    else if (open) setOpen({ ...open, mail: { ...open.mail, ...body } as Mail });
    if (done) notify(done);
    load();
  };

  const remove = async (mail: Mail) => {
    const { result } = await call<{ result: string }>(`/api/mail/messages/${mail.id}`, { method: 'DELETE' });
    setOpen(null);
    notify(result === 'deleted' ? 'Deleted for good.' : 'Moved to Trash.');
    load();
  };

  const summarize = async () => {
    if (!open) return;
    setSummary({ busy: true });
    try {
      const d = await call<{ summary: string }>(`/api/mail/messages/${open.mail.id}/summarize`, { method: 'POST' });
      setSummary({ text: d.summary });
    } catch (err) {
      setSummary({ error: (err as Error).message });
    }
  };

  const reply = (mail: Mail) => {
    const mine = mail.from_addr.toLowerCase() === me.email.toLowerCase();
    setDraft({
      to: mine ? mail.to.join(', ') : mail.from_addr,
      cc: '',
      subject: /^re:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`,
      body: '',
      inReplyToId: mail.id,
    });
  };

  const current = open?.mail;

  return (
    <div className={`mail ${open ? 'reading' : ''}`}>
      <nav className="mail-folders" aria-label="Mail folders">
        <button className="btn primary" onClick={() => setDraft({ to: '', cc: '', subject: '', body: '' })} title="New email">
          <Pencil size={15} /><span className="label-text">New email</span>
        </button>
        {FOLDERS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`folder ${folder === id ? 'active' : ''}`} title={label} onClick={() => { setFolder(id); setOpen(null); }}>
            <Icon size={16} /><span className="label-text">{label}</span>
            {!!unread[id] && <span className="count">{unread[id]}</span>}
          </button>
        ))}
      </nav>

      <section className="mail-list">
        <form className="mail-search" onSubmit={(e) => { e.preventDefault(); setQuery(search); }}>
          <Search size={15} />
          <input className="input" placeholder="Search mail" aria-label="Search mail" value={search}
            onChange={(e) => { setSearch(e.target.value); if (!e.target.value) setQuery(''); }} />
        </form>
        <div className="mail-items">
          {list === null && <div className="empty">Loading…</div>}
          {list?.length === 0 && <div className="empty">{query ? `Nothing matches “${query}”.` : 'Nothing here.'}</div>}
          {list?.map((m) => (
            <button key={m.id} className={`mail-item ${m.is_read ? '' : 'unread'} ${current?.id === m.id ? 'open' : ''}`} onClick={() => openMail(m.id)}>
              <div className="top">
                <span className="who">{m.folder === 'sent' ? `To: ${m.to.join(', ')}` : m.from_name || m.from_addr}</span>
                {m.is_starred && <Star size={12} fill="currentColor" style={{ color: 'var(--warn)' }} />}
                <span className="when" suppressHydrationWarning>{when(m.created_at)}</span>
              </div>
              <div className="subject">{m.subject || '(no subject)'}</div>
              <div className="snippet">{m.snippet}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="mail-reader">
        {!current ? (
          <div className="empty">Pick an email to read it.</div>
        ) : (
          <>
            <div className="reader-head">
              <button className="btn ghost icon back" onClick={() => setOpen(null)} title="Back to list" aria-label="Back to list"><ArrowLeft size={16} /></button>
              <h2>{current.subject || '(no subject)'}</h2>
              <button className="btn" onClick={summarize} disabled={summary.busy}>
                {summary.busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} Summarise
              </button>
              <button className="btn" onClick={() => reply(current)}><Reply size={15} /> Reply</button>
              <button className={`btn ghost icon ${current.is_starred ? 'on' : ''}`} title={current.is_starred ? 'Remove star' : 'Star'} aria-label="Star"
                onClick={() => patch(current, { is_starred: !current.is_starred })}>
                <Star size={16} fill={current.is_starred ? 'currentColor' : 'none'} />
              </button>
              {current.folder === 'inbox' && (
                <button className="btn ghost icon" title="Archive" aria-label="Archive" onClick={() => patch(current, { folder: 'archive' }, 'Archived.')}><Archive size={16} /></button>
              )}
              {(current.folder === 'archive' || current.folder === 'trash') && (
                <button className="btn ghost icon" title="Move back to Inbox" aria-label="Move back to Inbox" onClick={() => patch(current, { folder: 'inbox' }, 'Moved to Inbox.')}><Undo2 size={16} /></button>
              )}
              <button className="btn ghost icon" title={current.folder === 'trash' ? 'Delete for good' : 'Move to Trash'} aria-label="Delete" onClick={() => remove(current)}><Trash2 size={16} /></button>
            </div>
            <div className="reader-body">
              {summary.error && <div className="error" style={{ marginBottom: 14 }}>{summary.error}</div>}
              {summary.text && (
                <div className="summary"><b><Sparkles size={13} /> Summary</b>{summary.text}</div>
              )}
              {open!.thread.map((m) => (
                <article key={m.id} className="msg">
                  <div className="msg-head">
                    <div className="avatar">{initials(m.from_name || m.from_addr)}</div>
                    <div className="grow">
                      <div><strong>{m.from_name || m.from_addr}</strong> <span className="muted mono">{m.from_addr}</span></div>
                      <div className="to">To: {m.to.join(', ')}{m.cc.length ? ` · Cc: ${m.cc.join(', ')}` : ''}</div>
                    </div>
                    <span className="muted mono" suppressHydrationWarning>{when(m.created_at)}</span>
                  </div>
                  {m.body_html && !m.body_text ? (
                    <iframe title="Email content" sandbox="" srcDoc={m.body_html} />
                  ) : (
                    <div className="msg-text">{m.body_text}</div>
                  )}
                  {m.delivery?.filter((d) => d.status === 'failed').map((d) => (
                    <div key={d.to} className="error failed">Not delivered to {d.to}. {d.detail}</div>
                  ))}
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {draft && (
        <Compose
          draft={draft}
          people={people}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSent={(delivery) => {
            setDraft(null);
            const failed = delivery.filter((d) => d.status === 'failed');
            notify(failed.length ? `Sent, but not delivered to ${failed.map((d) => d.to).join(', ')}.` : 'Sent.');
            load();
            if (open) openMail(open.mail.id);
          }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Compose({ draft, people, onChange, onClose, onSent }: {
  draft: Draft;
  people: { name: string; email: string }[];
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSent: (delivery: Delivery[]) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<'send' | 'ai' | null>(null);
  const [error, setError] = useState('');
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...draft, [k]: e.target.value });

  const write = async () => {
    setBusy('ai');
    setError('');
    try {
      const d = await call<{ subject?: string; body: string }>('/api/mail/draft', { body: { instruction, replyToId: draft.inReplyToId } });
      onChange({ ...draft, body: d.body, subject: draft.subject || d.subject || '' });
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  };

  const send = async () => {
    setBusy('send');
    setError('');
    try {
      const d = await call<{ delivery: Delivery[] }>('/api/mail/send', {
        body: { to: splitAddrs(draft.to), cc: splitAddrs(draft.cc), subject: draft.subject, body: draft.body, inReplyToId: draft.inReplyToId },
      });
      onSent(d.delivery);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="compose" role="dialog" aria-label="Write email">
      <div className="compose-head">
        <span>{draft.inReplyToId ? 'Reply' : 'New email'}</span>
        <button className="btn ghost icon" onClick={onClose} title="Discard" aria-label="Discard"><X size={16} /></button>
      </div>
      <div className="compose-row">
        <label htmlFor="c-to">To</label>
        <input id="c-to" list="databag-people" autoFocus={!draft.inReplyToId} value={draft.to} onChange={set('to')} placeholder="name@company.com, …" />
        <datalist id="databag-people">{people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</datalist>
      </div>
      <div className="compose-row">
        <label htmlFor="c-cc">Cc</label>
        <input id="c-cc" list="databag-people" value={draft.cc} onChange={set('cc')} />
      </div>
      <div className="compose-row">
        <label htmlFor="c-subject">Subject</label>
        <input id="c-subject" value={draft.subject} onChange={set('subject')} />
      </div>
      <textarea aria-label="Message" value={draft.body} onChange={set('body')} autoFocus={!!draft.inReplyToId} placeholder="Write your message…" />
      <form className="compose-ai" onSubmit={(e) => { e.preventDefault(); write(); }}>
        <input className="input" aria-label="Tell the assistant what to write" value={instruction} onChange={(e) => setInstruction(e.target.value)}
          placeholder={draft.inReplyToId ? 'What should the reply say? (optional)' : 'Tell the assistant what to write…'} />
        <button className="btn" disabled={busy !== null || (!draft.inReplyToId && !instruction.trim())}>
          {busy === 'ai' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {busy === 'ai' ? 'Writing…' : 'Write with AI'}
        </button>
      </form>
      <div className="compose-foot">
        <button className="btn primary" onClick={send} disabled={busy !== null}>
          {busy === 'send' ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Send
        </button>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
