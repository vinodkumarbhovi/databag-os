'use client';

import { Loader2, Mic } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ask } from './agentBus';

/**
 * Speech to text, like dictation software: hold the right Option key (⌥) anywhere,
 * speak, and let go. The words are typed into whatever field had focus; with no field
 * focused they go to the agent. Audio is sent only to this computer's own AI model.
 */

/** 16 kHz mono 16-bit WAV, the format the local model reads. */
function toWav(samples: Float32Array, rate = 16000): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

async function transcribe(blob: Blob): Promise<string> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  void ctx.close();
  if (decoded.duration < 0.35) return '';
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  // Skip silence: nothing louder than a whisper means nothing was said.
  if (!pcm.some((x) => Math.abs(x) > 0.02)) return '';
  const res = await fetch('/api/speech', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: toWav(pcm) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Speech could not be turned into text.');
  return data.text ?? '';
}

export type RecorderState = 'idle' | 'listening' | 'writing';

/** Record from the microphone; stop() resolves with the text. */
export function useRecorder(onError: (message: string) => void) {
  const [state, setState] = useState<RecorderState>('idle');
  const rec = useRef<{ media: MediaRecorder; chunks: Blob[]; stream: MediaStream; stopped: Promise<void> } | null>(null);
  const start = useCallback(async () => {
    if (rec.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      // Resolves however recording ends: our stop, or the microphone going away.
      const stopped = new Promise<void>((resolve) => { media.onstop = () => resolve(); });
      media.start();
      rec.current = { media, chunks, stream, stopped };
      setState('listening');
    } catch {
      onError(window.isSecureContext ? 'Allow microphone access in the browser to dictate.' : 'Dictation needs databag to be opened at localhost or over https.');
    }
  }, [onError]);
  const stop = useCallback(async (): Promise<string> => {
    const r = rec.current;
    if (!r) return '';
    rec.current = null;
    if (r.media.state !== 'inactive') r.media.stop();
    await r.stopped;
    r.stream.getTracks().forEach((t) => t.stop());
    setState('writing');
    try { return await transcribe(new Blob(r.chunks, { type: r.media.mimeType })); }
    catch (err) { onError((err as Error).message); return ''; }
    finally { setState('idle'); }
  }, [onError]);
  return { state, start, stop };
}

/** A microphone button: click to start, click again to finish. */
export function MicButton({ onText, onError, label = 'Dictate', className = 'btn icon' }: { onText: (text: string) => void; onError: (m: string) => void; label?: string; className?: string }) {
  const { state, start, stop } = useRecorder(onError);
  const click = async () => { if (state === 'idle') start(); else if (state === 'listening') { const t = await stop(); if (t) onText(t); } };
  return (
    <button type="button" className={`${className} mic ${state}`} onClick={click} disabled={state === 'writing'} title={state === 'listening' ? 'Click to finish' : `${label} (or hold the right ⌥ key)`} aria-label={state === 'listening' ? 'Stop dictating' : label}>
      {state === 'writing' ? <Loader2 size={15} className="spin" /> : <Mic size={15} />}
    </button>
  );
}

/** Put text where the cursor was, as if typed, so every app (and React) sees it. */
function insertInto(target: Element | null, text: string): boolean {
  const el = target as HTMLElement | null;
  const editable = el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|email|url|tel|)$/.test(el.type)) || el.isContentEditable);
  if (!editable || !el.isConnected) return false;
  el.focus();
  const before = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value.slice(0, el.selectionStart ?? el.value.length) : '';
  const spaced = before && !/\s$/.test(before) ? ` ${text}` : text;
  if (!document.execCommand('insertText', false, spaced) && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    el.setRangeText(spaced, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return true;
}

/** Hold the right Option key to dictate anywhere in databag. */
export function Dictation() {
  const [error, setError] = useState('');
  const onError = useCallback((m: string) => { setError(m); setTimeout(() => setError(''), 4000); }, []);
  const { state, start, stop } = useRecorder(onError);
  const target = useRef<Element | null>(null);
  const held = useRef<{ timer: ReturnType<typeof setTimeout>; started: boolean } | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'AltRight') { if (held.current && !held.current.started) { clearTimeout(held.current.timer); held.current = null; } return; }
      if (e.repeat || held.current) return;
      // Start only after a short hold, so ⌥ shortcuts and special characters keep working.
      held.current = { started: false, timer: setTimeout(() => { if (held.current) { held.current.started = true; target.current = document.activeElement; start(); } }, 250) };
    };
    const up = async (e: KeyboardEvent) => {
      if (e.code !== 'AltRight' || !held.current) return;
      const h = held.current; held.current = null;
      clearTimeout(h.timer);
      if (!h.started) return;
      const text = await stop();
      if (!text) return;
      if (!insertInto(target.current, text)) ask(text);
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }, [start, stop]);

  if (state === 'idle' && !error) return null;
  return (
    <div className={`dictation-pill ${error ? 'error' : state}`} role="status" aria-live="polite">
      {error ? error : state === 'listening' ? <><span className="rec-dot" /> Listening… let go of ⌥ to insert</> : <><Loader2 size={14} className="spin" /> Writing it down…</>}
    </div>
  );
}
