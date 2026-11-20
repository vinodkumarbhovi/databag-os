'use client';

import { Home, LogOut, Moon, Settings, Sun } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AppInfo } from '@/lib/catalog';
import { call, initials } from '@/lib/client';
import { AppIcon } from './AppIcon';
import { Assistant } from './Assistant';
import { Brand } from './Brand';
import { Dictation } from './Dictation';
import { Search } from './Search';

type Props = { user: { name: string; email: string }; company: string; logo?: string | null; groups: string[]; apps: (AppInfo & { enabled: boolean })[]; unread: number; children: React.ReactNode };

export function Shell({ user, company, logo, groups, apps, unread, children }: Props) {
  const path = usePathname();
  const [ai, setAi] = useState<boolean | null>(null);
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  useEffect(() => { call<{ ai: { ok: boolean; installed: boolean } }>('/api/system').then((s) => setAi(s.ai.ok && s.ai.installed)).catch(() => setAi(false)); }, []);

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('databag-theme', next); } catch {}
  };
  const signOut = async () => {
    await call('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  };
  const enabled = apps.filter((a) => a.enabled);

  return (
    <div className="os">
      <aside className="sidebar">
        <Brand sub={company} logo={logo} />
        <Search />
        <nav className="nav" aria-label="Apps">
          <Link href="/" className={`nav-item ${active('/') ? 'active' : ''}`}><Home size={17} strokeWidth={1.7} /><span>Today</span></Link>
          {groups.map((g) => {
            const list = enabled.filter((a) => a.group === g);
            if (!list.length) return null;
            return (
              <div key={g} className="nav-group">
                <div className="nav-title">{g}</div>
                {list.map((app) => (
                  <Link key={app.id} href={`/${app.id}`} className={`nav-item ${active(`/${app.id}`) ? 'active' : ''}`}>
                    <AppIcon id={app.id} size={17} /><span>{app.name}</span>
                    {app.id === 'mail' && unread > 0 && <span className="badge-n">{unread}</span>}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <Link href="/settings" className={`nav-item ${active('/settings') ? 'active' : ''}`}><Settings size={17} strokeWidth={1.7} /><span>Settings</span></Link>
          <div className="running" title={ai === false ? 'The local AI model is not reachable. See Settings.' : 'Everything runs on this computer'}>
            <span className={`dot ${ai === false ? 'bad' : ''}`} />
            <span style={{ flex: 1 }}>{ai === false ? 'AI model offline' : 'Running on your machine'}</span>
            <button className="btn icon theme-btn" onClick={toggleTheme} title="Light or dark" aria-label="Switch light or dark theme">
              <Sun size={14} className="theme-sun" /><Moon size={14} className="theme-moon" />
            </button>
          </div>
          <div className="me">
            <div className="avatar">{initials(user.name)}</div>
            <div className="me-text">
              <div>{user.name}</div>
              <div className="mono">{user.email}</div>
            </div>
            <button className="btn ghost icon" onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
      <Assistant />
      <Dictation />
    </div>
  );
}
