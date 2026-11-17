'use client';

import { Sparkles } from 'lucide-react';
import { ask } from './agentBus';

/** The header every app page shares: name, what it is for, what it replaces, and the app's agent. */
export function AppFrame({ name, description, replaces, children }: { name: string; description: string; replaces: string; children: React.ReactNode }) {
  return (
    <div className="app-page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="serif">{name}</h1>
          <div className="muted">{description}</div>
        </div>
        <span className="replaces">Replaces {replaces}</span>
        <button className="btn" onClick={() => ask()} title={`Open the ${name} agent (⌘J). Hold the right ⌥ key to talk.`}><Sparkles size={15} /> {name} agent</button>
      </header>
      {children}
    </div>
  );
}
