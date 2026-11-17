import crypto from 'node:crypto';
import { chat as ai } from '../ai.ts';
import { listUsers } from '../auth.ts';
import { all, get, run } from '../db.ts';
import { type Handlers, need } from '../rpc.ts';

type Channel = { id: string; name: string; kind: 'channel' | 'dm'; members: string };

function channelFor(userId: string, id: string): Channel {
  const c = get<Channel>('SELECT * FROM chat_channels WHERE id = ?', id);
  need(c && (c.kind === 'channel' || (JSON.parse(c.members) as string[]).includes(userId)), 'Conversation not found.');
  return c;
}

export const chat: Handlers = {
  /** Channels everyone can see, the user's direct messages, and the people they can message. */
  'chat.channels': (u) => {
    if (!get('SELECT 1 FROM chat_channels WHERE kind = ?', 'channel'))
      run('INSERT INTO chat_channels (id, name, created_at) VALUES (?, ?, ?)', crypto.randomUUID(), 'general', Date.now());
    const users = listUsers();
    const name = (id: string) => users.find((x) => x.id === id)?.name ?? 'Unknown';
    const rows = all<Channel>('SELECT * FROM chat_channels ORDER BY kind, name');
    return {
      channels: rows.filter((c) => c.kind === 'channel').map((c) => ({ id: c.id, name: c.name })),
      dms: rows
        .filter((c) => c.kind === 'dm' && (JSON.parse(c.members) as string[]).includes(u.id))
        .map((c) => ({ id: c.id, name: name((JSON.parse(c.members) as string[]).find((m) => m !== u.id) ?? u.id) })),
      people: users.filter((x) => x.id !== u.id).map((x) => ({ id: x.id, name: x.name })),
    };
  },

  'chat.createChannel': (_u, { name }: { name: string }) => {
    const clean = name?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    need(clean, 'Give the channel a name.');
    need(!get('SELECT 1 FROM chat_channels WHERE kind = ? AND name = ?', 'channel', clean), `#${clean} already exists.`);
    const id = crypto.randomUUID();
    run('INSERT INTO chat_channels (id, name, created_at) VALUES (?, ?, ?)', id, clean, Date.now());
    return { id };
  },

  'chat.openDm': (u, { userId }: { userId: string }) => {
    const members = JSON.stringify([u.id, userId].sort());
    const existing = get<{ id: string }>('SELECT id FROM chat_channels WHERE kind = ? AND members = ?', 'dm', members);
    if (existing) return existing;
    const id = crypto.randomUUID();
    run('INSERT INTO chat_channels (id, name, kind, members, created_at) VALUES (?, ?, ?, ?, ?)', id, 'dm', 'dm', members, Date.now());
    return { id };
  },

  'chat.messages': (u, { channelId }: { channelId: string }) => {
    channelFor(u.id, channelId);
    return all(
      `SELECT m.id, m.body, m.created_at, m.user_id, u.name FROM chat_messages m JOIN users u ON u.id = m.user_id
       WHERE m.channel_id = ? ORDER BY m.created_at DESC LIMIT 200`, channelId,
    ).reverse();
  },

  'chat.send': (u, { channelId, body }: { channelId: string; body: string }) => {
    channelFor(u.id, channelId);
    need(body?.trim(), 'Write a message first.');
    run('INSERT INTO chat_messages (id, channel_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)', crypto.randomUUID(), channelId, u.id, body.trim().slice(0, 8000), Date.now());
  },

  'chat.summarise': async (u, { channelId }: { channelId: string }) => {
    channelFor(u.id, channelId);
    const rows = all<{ name: string; body: string }>(
      'SELECT u.name, m.body FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? ORDER BY m.created_at DESC LIMIT 80', channelId,
    ).reverse();
    need(rows.length, 'There is nothing to summarise yet.');
    return {
      summary: await ai([
        { role: 'system', content: 'Summarise this team chat in plain text, no markdown. Give at most four short lines starting with "- ", then any decisions or open questions.' },
        { role: 'user', content: rows.map((r) => `${r.name}: ${r.body}`).join('\n') },
      ], { temperature: 0.2, maxTokens: 300 }),
    };
  },
};
