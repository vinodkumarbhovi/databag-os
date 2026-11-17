'use client';

import { Search as SearchIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { call, when } from '@/lib/client';
import type { Hit } from '@/lib/search';
import { AppIcon } from './AppIcon';

const NAMES: Record<string, string> = { mail: 'Mail', docs: 'Docs', sheets: 'Sheets', slides: 'Slides', drive: 'Drive', contacts: 'Contacts', crm: 'CRM', accounting: 'Accounting', projects: 'Projects', calendar: 'Calendar', chat: 'Chat', sign: 'Sign' };

/** The sidebar search box and the ⌘K search window that searches every app. */
export function Search() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); }
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.select(), 20); }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(() => call<{ hits: Hit[] }>(`/api/search?q=${encodeURIComponent(q)}`).then((d) => { setHits(d.hits); setAt(0); }).catch(() => setHits([])), 180);
    return () => clearTimeout(t);
  }, [q]);

  // Apps read the link (?id=, ?open=) when they load, so a link to the page already open needs a full load.
  const go = (h: Hit) => { setOpen(false); if (location.pathname === h.href.split('?')[0]) location.assign(h.href); else router.push(h.href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (!hits?.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[at]); }
  };

  return (
    <>
      <button className="side-search" onClick={() => setOpen(true)}>
        <SearchIcon size={15} /><span>Search everything</span><kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="modal-back search-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="search-box" role="dialog" aria-label="Search">
            <div className="search-input">
              <SearchIcon size={18} color="var(--accent)" />
              <input ref={input} aria-label="Search everything" placeholder="Search mail, documents, customers, invoices, tasks…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
              <kbd>esc</kbd>
            </div>
            <div className="search-results" role="listbox">
              {hits === null && <div className="panel-empty">Type at least two letters. Every app you have is searched at once.</div>}
              {hits?.length === 0 && <div className="panel-empty">Nothing found for “{q}”.</div>}
              {hits?.map((h, i) => (
                <button key={i} role="option" aria-selected={i === at} className={`search-hit ${i === at ? 'on' : ''}`} onMouseEnter={() => setAt(i)} onClick={() => go(h)}>
                  <span className="panel-icon"><AppIcon id={h.app} size={15} /></span>
                  <span className="grow"><strong>{h.title}</strong><span className="muted small">{NAMES[h.app] ?? h.app} · {h.sub}</span></span>
                  {h.at && <span className="mono muted">{when(h.at)}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
