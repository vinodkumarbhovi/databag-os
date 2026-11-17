'use client';

import { Hash, Loader2, Plus, Send, Sparkles, User } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { initials, param, rpc, when } from '@/lib/client';
import { useToast } from './ui';

type Item = { id: string; name: string };
type Lists = { channels: Item[]; dms: Item[]; people: Item[] };
type Msg = { id: string; body: string; created_at: number; user_id: string; name: string };

export function ChatApp() {
  const [lists, setLists] = useState<Lists>({ channels: [], dms: [], people: [] });
  const [current, setCurrent] = useState<{ id: string; label: string } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [summary, setSummary] = useState<{ text?: string; busy?: boolean }>({});
  const logRef = useRef<HTMLDivElement>(null);
  const { toast, notify, attempt } = useToast();

  const loadLists = useCallback(async () => {
    const d = await rpc<Lists>('chat.channels');
    setLists(d);
    // Search links here with ?channel=<id>.
    const wanted = param('channel');
    const linked = wanted ? d.channels.find((c) => c.id === wanted) ?? d.dms.find((c) => c.id === wanted) : undefined;
    const label = (c: Item) => (d.channels.includes(c) ? `# ${c.name}` : c.name);
    setCurrent((c) => c ?? (linked ? { id: linked.id, label: label(linked) } : d.channels[0] ? { id: d.channels[0].id, label: `# ${d.channels[0].name}` } : null));
  }, []);
  useEffect(() => { loadLists().catch((e) => notify(e.message)); }, [loadLists, notify]);

  const channelId = current?.id;
  useEffect(() => {
    if (!channelId) return;
    setMessages([]);
    setSummary({});
    let last = '';
    const tick = () => rpc<Msg[]>('chat.messages', { channelId }).then((m) => {
      const newest = m.at(-1)?.id ?? '';
      setMessages(m);
      if (newest !== last) { last = newest; requestAnimationFrame(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight)); }
    }).catch(() => {});
    tick();
    const timer = setInterval(tick, 2500);
    return () => clearInterval(timer);
  }, [channelId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !channelId) return;
    const body = text;
    setText('');
    if (await attempt(() => rpc('chat.send', { channelId, body }))) setMessages(await rpc<Msg[]>('chat.messages', { channelId }));
  };
  const addChannel = async () => {
    const name = window.prompt('Name for the new channel');
    if (!name) return;
    await attempt(async () => {
      const { id } = await rpc<{ id: string }>('chat.createChannel', { name });
      await loadLists();
      setCurrent({ id, label: `# ${name.trim().toLowerCase()}` });
    });
  };
  const openDm = (p: Item) => attempt(async () => {
    const { id } = await rpc<{ id: string }>('chat.openDm', { userId: p.id });
    await loadLists();
    setCurrent({ id, label: p.name });
  });
  const summarise = async () => {
    setSummary({ busy: true });
    try { setSummary({ text: (await rpc<{ summary: string }>('chat.summarise', { channelId })).summary }); }
    catch (err) { setSummary({}); notify((err as Error).message); }
  };

  return (
    <div className="chat">
      <nav className="chat-side">
        <div className="nav-title" style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>Channels</span>
          <button className="btn ghost icon" style={{ height: 22, width: 22 }} onClick={addChannel} aria-label="New channel" title="New channel"><Plus size={14} /></button>
        </div>
        {lists.channels.map((c) => (
          <button key={c.id} className={`folder ${channelId === c.id ? 'active' : ''}`} onClick={() => setCurrent({ id: c.id, label: `# ${c.name}` })}><Hash size={15} />{c.name}</button>
        ))}
        <div className="nav-title">People</div>
        {lists.people.map((p) => {
          const dm = lists.dms.find((d) => d.name === p.name);
          return <button key={p.id} className={`folder ${dm && channelId === dm.id ? 'active' : ''}`} onClick={() => openDm(p)}><User size={15} />{p.name}</button>;
        })}
        {!lists.people.length && <div className="muted" style={{ padding: 8, fontSize: 12 }}>Add colleagues in Settings to message them.</div>}
      </nav>
      <section className="chat-main">
        <div className="bar">
          <h1>{current?.label ?? 'Chat'}</h1>
          <button className="btn" onClick={summarise} disabled={summary.busy || !messages.length}>
            {summary.busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} Summarise
          </button>
        </div>
        <div className="chat-log" ref={logRef}>
          {summary.text && <div className="ai-box">{summary.text}</div>}
          {!messages.length && <div className="empty">No messages yet. Say hello.</div>}
          {messages.map((m) => (
            <div key={m.id} className="chat-msg">
              <div className="avatar">{initials(m.name)}</div>
              <div>
                <div><strong>{m.name}</strong> <span className="muted mono">{when(m.created_at)}</span></div>
                <div className="text">{m.body}</div>
              </div>
            </div>
          ))}
        </div>
        <form className="chat-input" onSubmit={send}>
          <input className="input" aria-label="Message" placeholder={current ? `Message ${current.label}` : 'Message'} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn primary" style={{ height: 36 }} disabled={!text.trim()}><Send size={15} /> Send</button>
        </form>
      </section>
      {toast}
    </div>
  );
}
