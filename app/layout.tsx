import type { Metadata } from 'next';
import { loadConfig } from '@/lib/config';
import './globals.css';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  const { company } = loadConfig();
  const named = company.name && company.name !== 'My Company';
  return { title: named ? `${company.name} · databag` : 'databag', description: 'Your company OS', ...(company.logo ? { icons: { icon: `/api/brand/logo?v=${company.logo.v}` } } : {}) };
}

// Set the theme before first paint so there is no flash of the wrong colours.
const themeScript = `try{var t=localStorage.getItem('databag-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;var a=localStorage.getItem('databag-accent');if(a&&/^#[0-9a-f]{6}$/i.test(a))document.documentElement.style.setProperty('--ac',a)}catch(e){document.documentElement.dataset.theme='light'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const accent = loadConfig().company.accent;
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        {accent && /^#[0-9a-f]{6}$/i.test(accent) && <style>{`:root{--ac:${accent}}`}</style>}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
