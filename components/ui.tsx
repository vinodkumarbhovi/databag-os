'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="compose-head">
          <span>{title}</span>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field" style={{ display: 'block' }}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

/** A short message at the bottom of the screen that fades after a few seconds. */
export function useToast() {
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((message: string) => {
    setText(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(''), 4000);
  }, []);
  /** Run an action and show its error, if any, as a toast. */
  const attempt = useCallback(async (action: () => Promise<unknown>, done?: string) => {
    try {
      await action();
      if (done) notify(done);
      return true;
    } catch (err) {
      notify((err as Error).message);
      return false;
    }
  }, [notify]);
  return { toast: text ? <div className="toast" role="status">{text}</div> : null, notify, attempt };
}
