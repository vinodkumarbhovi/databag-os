import crypto from 'node:crypto';
import { chat as ai } from '../ai.ts';
import { all, get, run } from '../db.ts';
import { type Handlers, need } from '../rpc.ts';

type Room = { id: string; title: string; host_id: string; notes: string; summary: string | null; created_at: number };
// Who is in each call right now, and the connection details browsers pass each other.
// Kept in the database (not memory) so it works when several servers answer requests.
const STALE = 12_000;
function peersOf(room: string): { id: string; name: string }[] {
  run('DELETE FROM meet_peers WHERE seen < ?', Date.now() - STALE);
  run('DELETE FROM meet_signals WHERE created_at < ?', Date.now() - 60_000);
  return all<{ peer_id: string; name: string }>('SELECT peer_id, name FROM meet_peers WHERE room = ?', room).map((p) => ({ id: p.peer_id, name: p.name }));
}

export const meet: Handlers = {
  'meet.list': () => all<Room>('SELECT * FROM meet_rooms ORDER BY created_at DESC LIMIT 50').map((r) => ({ ...r, live: peersOf(r.id).length })),

  'meet.create': (u, { title }: { title: string }) => {
    need(title?.trim(), 'Give the meeting a name.');
    const id = crypto.randomUUID();
    run('INSERT INTO meet_rooms (id, title, host_id, created_at) VALUES (?, ?, ?, ?)', id, title.trim(), u.id, Date.now());
    return { id };
  },

  'meet.get': (_u, { id }: { id: string }) => {
    const room = get<Room>('SELECT * FROM meet_rooms WHERE id = ?', id);
    need(room, 'That meeting does not exist.');
    return room;
  },

  'meet.saveNotes': (_u, { id, notes }: { id: string; notes: string }) => {
    run('UPDATE meet_rooms SET notes = ? WHERE id = ?', notes ?? '', id);
  },

  'meet.summarise': async (_u, { id }: { id: string }) => {
    const room = get<Room>('SELECT * FROM meet_rooms WHERE id = ?', id);
    need(room && room.notes.trim(), 'Write some notes first.');
    const summary = await ai([
      { role: 'system', content: 'Turn these raw meeting notes into a clean summary in plain text, no markdown: "Summary:" with up to four lines starting "- ", then "Actions:" with one line per action starting "- " and naming the owner when known.' },
      { role: 'user', content: `Meeting: ${room.title}\n\n${room.notes.slice(0, 8000)}` },
    ], { temperature: 0.2, maxTokens: 400 });
    run('UPDATE meet_rooms SET summary = ? WHERE id = ?', summary, id);
    return { summary };
  },

  // --- Call signalling: browsers swap connection details through here, then talk directly. ---
  'meet.join': (u, { room }: { room: string }) => {
    need(get('SELECT 1 FROM meet_rooms WHERE id = ?', room), 'That meeting does not exist.');
    const others = peersOf(room);
    const peerId = crypto.randomUUID();
    run('INSERT INTO meet_peers (peer_id, room, name, seen) VALUES (?, ?, ?, ?)', peerId, room, u.name, Date.now());
    return { peerId, peers: others };
  },

  'meet.poll': (_u, { room, peerId }: { room: string; peerId: string }) => {
    need(get('SELECT 1 FROM meet_peers WHERE peer_id = ? AND room = ? AND seen >= ?', peerId, room, Date.now() - STALE), 'You have left this call.');
    run('UPDATE meet_peers SET seen = ? WHERE peer_id = ?', Date.now(), peerId);
    const rows = all<{ id: number; from_peer: string; data: string }>('SELECT id, from_peer, data FROM meet_signals WHERE to_peer = ? ORDER BY id', peerId);
    if (rows.length) run(`DELETE FROM meet_signals WHERE id IN (${rows.map(() => '?').join(',')})`, ...rows.map((r) => r.id));
    return { peers: peersOf(room).filter((p) => p.id !== peerId), signals: rows.map((r) => ({ from: r.from_peer, data: JSON.parse(r.data) })) };
  },

  'meet.signal': (_u, { room, from, to, data }: { room: string; from: string; to: string; data: unknown }) => {
    if (get('SELECT 1 FROM meet_peers WHERE peer_id = ? AND room = ?', to, room)) run('INSERT INTO meet_signals (room, to_peer, from_peer, data, created_at) VALUES (?, ?, ?, ?, ?)', room, to, from, JSON.stringify(data ?? null).slice(0, 200_000), Date.now());
  },

  'meet.leave': (_u, { room, peerId }: { room: string; peerId: string }) => {
    run('DELETE FROM meet_peers WHERE peer_id = ? AND room = ?', peerId, room);
  },
};
