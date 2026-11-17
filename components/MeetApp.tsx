'use client';

import { ArrowLeft, Copy, Loader2, Mic, MicOff, PhoneOff, Plus, Sparkles, Video, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { param, rpc, when } from '@/lib/client';
import { useToast } from './ui';

type Room = { id: string; title: string; notes: string; summary: string | null; created_at: number; live?: number };
type Remote = { id: string; name: string; stream: MediaStream };
type Signal = { from: string; data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } };

export function MeetApp({ me }: { me: { name: string } }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const { toast, notify, attempt } = useToast();

  const load = useCallback(() => rpc<Room[]>('meet.list').then(setRooms).catch(() => {}), []);
  const open = useCallback((id: string) => attempt(async () => setRoom(await rpc<Room>('meet.get', { id }))), [attempt]);
  useEffect(() => {
    load();
    const id = param('room');
    if (id) open(id);
  }, [load, open]);

  const create = async () => {
    const title = window.prompt('Name for the meeting');
    if (title) await attempt(async () => open((await rpc<{ id: string }>('meet.create', { title })).id));
  };

  if (room) return <>{<RoomView room={room} me={me} notify={notify} onLeave={() => { setRoom(null); history.replaceState(null, '', '/meet'); load(); }} />}{toast}</>;

  return (
    <div className="app">
      <div className="bar">
        <span className="grow-gap" />
        <button className="btn primary" onClick={create}><Plus size={15} /> New meeting</button>
      </div>
      <div className="body">
        {!rooms.length && <div className="empty">No meetings yet. Start one, or add a video call to a calendar event.</div>}
        <div className="file-grid">
          {rooms.map((r) => (
            <button key={r.id} className="card file-card" onClick={() => open(r.id)}>
              <strong>{r.title}</strong>
              <small>{when(r.created_at)}{r.live ? ` · ${r.live} in call now` : ''}</small>
              {r.summary && <span className="badge info" style={{ alignSelf: 'flex-start' }}>has summary</span>}
            </button>
          ))}
        </div>
      </div>
      {toast}
    </div>
  );
}

function VideoTile({ stream, name, muted }: { stream: MediaStream | null; name: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return (
    <div className="video">
      <video ref={ref} autoPlay playsInline muted={muted} />
      <span>{name}</span>
    </div>
  );
}

function RoomView({ room, me, notify, onLeave }: { room: Room; me: { name: string }; notify: (t: string) => void; onLeave: () => void }) {
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [warning, setWarning] = useState('');
  const [notes, setNotes] = useState(room.notes);
  const [summary, setSummary] = useState<{ text?: string; busy?: boolean }>({ text: room.summary ?? undefined });

  useEffect(() => {
    let stopped = false;
    let peerId = '';
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const pcs = new Map<string, RTCPeerConnection>();
    const names = new Map<string, string>();
    const send = (to: string, data: Signal['data']) => rpc('meet.signal', { room: room.id, from: peerId, to, data }).catch(() => {});

    // One direct connection per other person in the call.
    const connectionTo = (id: string) => {
      let pc = pcs.get(id);
      if (pc) return pc;
      pc = new RTCPeerConnection();
      if (stream) for (const track of stream.getTracks()) pc.addTrack(track, stream);
      else { pc.addTransceiver('video', { direction: 'recvonly' }); pc.addTransceiver('audio', { direction: 'recvonly' }); }
      pc.onicecandidate = (e) => { if (e.candidate) send(id, { candidate: e.candidate.toJSON() }); };
      pc.ontrack = (e) => setRemotes((r) => [...r.filter((x) => x.id !== id), { id, name: names.get(id) ?? 'Guest', stream: e.streams[0] }]);
      pcs.set(id, pc);
      return pc;
    };

    const tick = async () => {
      if (stopped) return;
      try {
        const d = await rpc<{ peers: { id: string; name: string }[]; signals: Signal[] }>('meet.poll', { room: room.id, peerId });
        for (const p of d.peers) names.set(p.id, p.name);
        for (const s of d.signals) {
          const pc = connectionTo(s.from);
          if (s.data.sdp) {
            await pc.setRemoteDescription(s.data.sdp);
            if (s.data.sdp.type === 'offer') {
              await pc.setLocalDescription(await pc.createAnswer());
              send(s.from, { sdp: pc.localDescription!.toJSON() });
            }
          } else if (s.data.candidate) await pc.addIceCandidate(s.data.candidate).catch(() => {});
        }
        const live = new Set(d.peers.map((p) => p.id));
        for (const [id, pc] of pcs) if (!live.has(id)) { pc.close(); pcs.delete(id); setRemotes((r) => r.filter((x) => x.id !== id)); }
      } catch { /* keep trying: a missed poll is recoverable */ }
      timer = setTimeout(tick, 1000);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        setWarning('Your camera and microphone are not available, so others cannot see or hear you. You can still watch and listen.');
      }
      if (stopped) { stream?.getTracks().forEach((t) => t.stop()); return; }
      setLocal(stream);
      const joined = await rpc<{ peerId: string; peers: { id: string; name: string }[] }>('meet.join', { room: room.id });
      peerId = joined.peerId;
      // The newcomer calls everyone already in the room.
      for (const p of joined.peers) {
        names.set(p.id, p.name);
        const pc = connectionTo(p.id);
        await pc.setLocalDescription(await pc.createOffer());
        send(p.id, { sdp: pc.localDescription!.toJSON() });
      }
      tick();
    })().catch((err) => notify((err as Error).message));

    return () => {
      stopped = true;
      clearTimeout(timer);
      pcs.forEach((pc) => pc.close());
      stream?.getTracks().forEach((t) => t.stop());
      if (peerId) rpc('meet.leave', { room: room.id, peerId }).catch(() => {});
    };
  }, [room.id, notify]);

  const toggle = (kind: 'audio' | 'video') => {
    const on = kind === 'audio' ? !mic : !cam;
    local?.getTracks().filter((t) => t.kind === kind).forEach((t) => (t.enabled = on));
    (kind === 'audio' ? setMic : setCam)(on);
  };
  const saveNotes = () => rpc('meet.saveNotes', { id: room.id, notes }).catch((e) => notify(e.message));
  const summarise = async () => {
    setSummary({ busy: true });
    try {
      await rpc('meet.saveNotes', { id: room.id, notes });
      setSummary({ text: (await rpc<{ summary: string }>('meet.summarise', { id: room.id })).summary });
    } catch (err) { setSummary({}); notify((err as Error).message); }
  };
  const copyLink = () => navigator.clipboard.writeText(`${location.origin}/meet?room=${room.id}`).then(() => notify('Link copied.'), () => notify('Could not copy the link.'));

  return (
    <div className="app">
      <div className="bar">
        <button className="btn ghost icon" onClick={onLeave} aria-label="Leave"><ArrowLeft size={16} /></button>
        <h1>{room.title}</h1>
        <button className="btn" onClick={copyLink}><Copy size={15} /> Copy invite link</button>
        <button className="btn icon" onClick={() => toggle('audio')} disabled={!local} aria-label={mic ? 'Mute' : 'Unmute'} title={mic ? 'Mute' : 'Unmute'}>{mic ? <Mic size={16} /> : <MicOff size={16} />}</button>
        <button className="btn icon" onClick={() => toggle('video')} disabled={!local} aria-label={cam ? 'Turn camera off' : 'Turn camera on'} title={cam ? 'Turn camera off' : 'Turn camera on'}>{cam ? <Video size={16} /> : <VideoOff size={16} />}</button>
        <button className="btn primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={onLeave}><PhoneOff size={15} /> Leave</button>
      </div>
      <div className="body">
        {warning && <div className="error" style={{ marginBottom: 14 }}>{warning}</div>}
        <div className="meet-room">
          <div className="videos">
            <VideoTile stream={local} name={`${me.name} (you)`} muted />
            {remotes.map((r) => <VideoTile key={r.id} stream={r.stream} name={r.name} />)}
          </div>
          <div>
            <label className="label" htmlFor="meet-notes">Meeting notes</label>
            <textarea id="meet-notes" className="input" style={{ height: 220 }} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder="Type notes during the call…" />
            <button className="btn" style={{ margin: '8px 0 12px' }} onClick={summarise} disabled={summary.busy || !notes.trim()}>
              {summary.busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} Summarise notes
            </button>
            {summary.text && <div className="ai-box">{summary.text}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
