// End-to-end tests: start a real databag on a throwaway data folder and use it like a browser would.
// Run with `npm test` after `npm run build`. AI tests run only when the configured model answers
// (local Ollama by default); set DATABAG_TEST_AI=0 to skip them.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SMTPServer } from 'smtp-server';

const ROOT = path.resolve(import.meta.dirname, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'databag-test-'));
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

let base, server, mx, mxPort, cookie = '';
const received = [];
const config = (patch) => { const p = path.join(HOME, 'config.json'); const c = JSON.parse(fs.readFileSync(p, 'utf8')); fs.writeFileSync(p, JSON.stringify(patch(c), null, 2)); };
async function api(url, { method, body, form } = {}) {
  const res = await fetch(base + url, {
    method: method ?? (body || form ? 'POST' : 'GET'), redirect: 'manual',
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const rpc = async (fn, args) => { const r = await api('/api/rpc', { body: { fn, args } }); if (r.status !== 200) throw new Error(`${fn}: ${JSON.stringify(r.data)}`); return r.data.result; };

before(async () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'Run `npm run build` first.');
  // A stand-in for the internet's mail servers: records what arrives.
  mxPort = await freePort();
  mx = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onAuth: (_a, _s, cb) => cb(null, { user: 'relay' }), onData(stream, session, done) {
    let raw = ''; stream.on('data', (c) => (raw += c)); stream.on('end', () => { received.push({ to: session.envelope.rcptTo.map((r) => r.address), raw }); done(); });
  } });
  await new Promise((r) => mx.listen(mxPort, '127.0.0.1', r));

  const port = await freePort();
  const smtpPort = await freePort();
  base = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(HOME, 'config.json'), JSON.stringify({ company: { name: 'Test Co', domain: 'test-co.example' }, host: '127.0.0.1', port, smtp: { host: '127.0.0.1', port: smtpPort } }));
  server = spawn(process.execPath, [path.join(ROOT, 'bin', 'databag.mjs'), 'start'], { env: { ...process.env, DATABAG_HOME: HOME }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/login`, { redirect: 'manual' })).status) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
});
after(async () => { server?.kill(); await new Promise((r) => mx?.close(r)); fs.rmSync(HOME, { recursive: true, force: true }); });

describe('setup and accounts', () => {
  test('a fresh install sends people to setup', async () => {
    const r = await api('/');
    assert.equal(r.status, 307);
  });
  test('the first account is created and signed in', async () => {
    const r = await api('/api/setup', { body: { company: 'Test Co', domain: 'test-co.example', name: 'Ada Owner', handle: 'ada', password: 'test-password-123' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.user.email, 'ada@test-co.example');
    assert.ok(cookie);
  });
  test('setup cannot run twice', async () => {
    const r = await api('/api/setup', { body: { company: 'X', domain: 'x.example', name: 'X', handle: 'x', password: 'test-password-123' } });
    assert.notEqual(r.status, 200);
  });
  test('a colleague gets a mailbox', async () => {
    const r = await api('/api/users', { body: { name: 'Ben Colleague', handle: 'ben', password: 'test-password-456' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });
});

describe('mail', () => {
  test('mail between colleagues is delivered at once', async () => {
    const r = await api('/api/mail/send', { body: { to: ['ben@test-co.example'], subject: 'Hello Ben', body: 'Inside the company.' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.delivery[0].status, 'delivered');
  });
  test('direct delivery reaches the recipient\'s mail server, DKIM-signed', async () => {
    config((c) => ({ ...c, mail: { outbound: 'direct', mxOverride: `127.0.0.1:${mxPort}` } }));
    const r = await api('/api/domain', { body: { action: 'test', to: 'someone@gmail.example' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.delivery[0].status, 'sent', JSON.stringify(r.data.delivery));
    const got = received.at(-1);
    assert.deepEqual(got.to, ['someone@gmail.example']);
    assert.match(got.raw, /DKIM-Signature: .*d=test-co\.example/s);
    assert.match(got.raw, /s=databag/);
  });
  test('a relay is used when one is set', async () => {
    config((c) => ({ ...c, mail: {}, relay: { host: '127.0.0.1', port: mxPort } }));
    const before = received.length;
    const r = await api('/api/domain', { body: { action: 'test', to: 'friend@outlook.example' } });
    assert.equal(r.data.delivery[0].status, 'relayed', JSON.stringify(r.data.delivery));
    assert.equal(received.length, before + 1);
  });
  test('sending out can be turned off', async () => {
    config((c) => { delete c.relay; return { ...c, mail: { outbound: 'off' } }; });
    const r = await api('/api/domain', { body: { action: 'test', to: 'friend@outlook.example' } });
    assert.equal(r.data.delivery[0].status, 'failed');
    assert.match(r.data.delivery[0].detail, /turned off/);
  });
});

describe('domain, address and brand', () => {
  test('the DNS records cover ownership, MX, SPF, DKIM and DMARC', async () => {
    const r = await api('/api/domain');
    assert.equal(r.status, 200);
    const values = r.data.records.map((x) => `${x.type} ${x.name} ${x.value}`).join('\n');
    assert.match(values, /TXT test-co\.example databag-verify=[a-f0-9]{32}/);
    assert.match(values, /MX test-co\.example mail\.test-co\.example/);
    assert.match(values, /TXT test-co\.example v=spf1/);
    assert.match(values, /TXT databag\._domainkey\.test-co\.example v=DKIM1; k=rsa; p=/);
    assert.match(values, /TXT _dmarc\.test-co\.example v=DMARC1/);
  });
  test('the public address replaces localhost', async () => {
    const r = await api('/api/domain', { method: 'PATCH', body: { url: 'https://os.test-co.example' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8')).company.url, 'https://os.test-co.example');
  });
  test('a logo can be uploaded and is served safely', async () => {
    const form = new FormData();
    form.append('logo', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), 'logo.svg');
    assert.equal((await api('/api/brand/logo', { form })).status, 200);
    const res = await fetch(`${base}/api/brand/logo`);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  });
});

describe('agents and value factories', () => {
  let a, b;
  test('agents are built from templates', async () => {
    a = (await rpc('agents.fromTemplate', { template: 'sales' })).id;
    b = (await rpc('agents.fromTemplate', { template: 'brand' })).id;
    const list = await rpc('agents.list');
    assert.equal(list.agents.length, 2);
    assert.ok(list.tools.length > 40);
  });
  test('each agent has its own memory', async () => {
    const db = new DatabaseSync(path.join(HOME, 'databag.db'));
    db.prepare('INSERT INTO agent_memory (id, agent_id, fact, created_at) VALUES (?, ?, ?, ?)').run('m1', a, 'Prefers short emails', Date.now());
    db.close();
    assert.equal((await rpc('agents.memories', { id: a })).length, 1);
    assert.equal((await rpc('agents.memories', { id: b })).length, 0);
  });
  test('API keys are never sent back to the browser', async () => {
    await rpc('agents.save', { id: a, name: 'Sales agent', tools: ['list_deals'], ai: { provider: 'openrouter', model: 'x/y', apiKey: 'sk-or-secret-test' } });
    const raw = JSON.stringify(await rpc('agents.list'));
    assert.ok(!raw.includes('sk-or-secret-test'));
    assert.ok(raw.includes('"hasKey":true'));
    await rpc('agents.save', { id: a, name: 'Sales agent', tools: ['list_deals', 'search_everything'], ai: { provider: 'default' } });
  });
  test('a value factory starts with tasks and an agent', async () => {
    const { id } = await rpc('factories.create', { template: 'campaign', name: 'Launch' });
    const tasks = await rpc('factories.tasks', { id });
    assert.ok(tasks.length >= 4);
    assert.ok(tasks.every((t) => t.agent_id));
  });
  test('the activity log starts empty and lists agents', async () => {
    const s = await rpc('activity.summary');
    assert.ok(Array.isArray(s.stats));
    assert.equal(s.agents.length, 3);
  });
});

describe('agents at work (needs the AI model)', async () => {
  const aiUp = process.env.DATABAG_TEST_AI !== '0' && await fetch('http://127.0.0.1:11434/v1/models', { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
  test('the assistant adds a reminder and it is logged', { skip: !aiUp && 'no AI model running' }, async () => {
    const r = await api('/api/agent', { body: { message: 'Put a reminder called Test reminder in my calendar tomorrow at 10:00. No attendees.', app: 'calendar' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const log = await rpc('activity.list', {});
    assert.ok(log.some((x) => x.tool === 'create_event' && x.agent_name === 'Assistant'), JSON.stringify(log.map((x) => x.tool)));
  });
  test('an agent must ask before using a tool it was not given', { skip: !aiUp && 'no AI model running' }, async () => {
    const { agents } = await rpc('agents.list');
    const sales = agents.find((x) => x.name === 'Sales agent');
    const r = await api('/api/agent', { body: { agent: sales.id, message: 'Use request_access to ask for the add_contact tool, because I want you to add contacts.', app: 'agents' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const waiting = (await rpc('activity.list', { status: 'waiting' })).find((x) => x.tool === 'request_access');
    assert.ok(waiting, 'an access request is waiting');
    await rpc('activity.decide', { id: waiting.id, approve: true });
    const after = (await rpc('agents.list')).agents.find((x) => x.id === sales.id);
    assert.ok(after.tools.includes('add_contact'), 'the tool was granted');
  });
});
