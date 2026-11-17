'use client';

import { Fragment, useEffect, useState } from 'react';
import { AccountingApp } from './AccountingApp';
import { CalendarApp } from './CalendarApp';
import { ChatApp } from './ChatApp';
import { CrmApp } from './CrmApp';
import { DriveApp } from './DriveApp';
import { MeetApp } from './MeetApp';
import { DocsApp, SheetsApp, SlidesApp } from './Office';
import { ContactsApp, ProjectsApp, SignApp, TaxApp } from './WorkApps';
import { LinkedInApp } from './LinkedInApp';
import { AgentsApp } from './AgentsApp';
import { FactoriesApp } from './FactoriesApp';

/** Renders one app. Apps use the clock and the address bar, so they start in the browser only. */
export function AppHost({ id, me }: { id: string; me: { name: string; email: string } }) {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => setReady(true), []);
  // When the agent changes something, reload the app on screen so it shows the change.
  // Editors and calls are left alone so nothing typed or live is lost.
  useEffect(() => {
    if (['docs', 'sheets', 'slides', 'meet'].includes(id)) return;
    const reload = () => setVersion((v) => v + 1);
    window.addEventListener('databag:changed', reload);
    return () => window.removeEventListener('databag:changed', reload);
  }, [id]);
  if (!ready) return null;
  return <Fragment key={version}>{render(id, me)}</Fragment>;
}

function render(id: string, me: { name: string; email: string }) {
  switch (id) {
    case 'calendar': return <CalendarApp />;
    case 'chat': return <ChatApp />;
    case 'meet': return <MeetApp me={me} />;
    case 'docs': return <DocsApp />;
    case 'sheets': return <SheetsApp />;
    case 'slides': return <SlidesApp />;
    case 'drive': return <DriveApp />;
    case 'crm': return <CrmApp />;
    case 'accounting': return <AccountingApp />;
    case 'contacts': return <ContactsApp />;
    case 'projects': return <ProjectsApp />;
    case 'sign': return <SignApp />;
    case 'tax': return <TaxApp />;
    case 'linkedin': return <LinkedInApp />;
    case 'agents': return <AgentsApp />;
    case 'factories': return <FactoriesApp />;
    default: return null;
  }
}
