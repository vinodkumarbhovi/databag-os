#!/usr/bin/env node
// databag CLI: pick your apps, then run the whole company OS as one process.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { CATALOG } from '../shared/catalog.mjs';
import { DEFAULTS, homeDir } from '../shared/defaults.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const HOME = homeDir();
const CONFIG = path.join(HOME, 'config.json');
const LOCAL_MODEL = DEFAULTS.ai.model;

const readConfig = () => (fs.existsSync(CONFIG) ? { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } : null);
function writeConfig(config) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

async function localModels(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? (await res.json()).data.map((m) => m.id) : null;
  } catch {
    return null;
  }
}

const LOGO_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
/** Copy a logo file into the data folder, where the app serves it from. */
function saveLogo(config, file) {
  const type = LOGO_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error('Use a PNG, JPG, WebP or SVG file.');
  if (fs.statSync(file).size > 1024 * 1024) throw new Error('The logo must be smaller than 1 MB.');
  fs.mkdirSync(path.join(HOME, 'brand'), { recursive: true });
  fs.copyFileSync(file, path.join(HOME, 'brand', 'logo'));
  config.company.logo = { type, v: Date.now() };
}
const cleanDomain = (v) => v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Set up databag for one company, in plain questions:
 * domain, company name, logo, which AI, which apps. Every answer can be changed later in Settings.
 * Non-interactive: databag init --yes [--domain acme.com] [--company "Acme"] [--logo logo.png] [--openrouter-key …]
 */
async function init(args) {
  const config = readConfig() ?? structuredClone(DEFAULTS);
  const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const available = CATALOG.filter((a) => a.status === 'available');

  if (args.includes('--yes') || !process.stdin.isTTY) {
    if (flag('domain')) config.company.domain = cleanDomain(flag('domain'));
    if (flag('company')) config.company.name = flag('company');
    if (flag('url')) config.company.url = flag('url');
    if (flag('logo')) saveLogo(config, path.resolve(flag('logo')));
    const key = flag('openrouter-key') ?? process.env.OPENROUTER_API_KEY;
    if (key) config.ai = { baseUrl: 'https://openrouter.ai/api/v1', model: flag('model') ?? 'google/gemini-2.5-flash', apiKey: key, extraBody: {} };
    else if (flag('model')) config.ai.model = flag('model');
    writeConfig(config);
    console.log(`databag: wrote settings to ${CONFIG}`);
    return config;
  }

  const p = await import('@clack/prompts');
  const stop = (v) => {
    if (p.isCancel(v)) { p.cancel('Setup cancelled. Nothing was changed.'); process.exit(0); }
    return v;
  };

  p.intro('databag: your company OS');
  p.log.message('A few questions to make it yours. Everything can be changed later in Settings.');

  // 1. Domain: the company's email addresses and, optionally, the address people open databag at.
  const domain = cleanDomain(stop(await p.text({
    message: 'Your company domain (from your domain provider, e.g. acme.com)',
    placeholder: 'acme.com', initialValue: config.company.domain === DEFAULTS.company.domain ? '' : config.company.domain,
    validate: (v) => (DOMAIN_RE.test(cleanDomain(v ?? '')) ? undefined : 'Enter a domain like acme.com'),
  })));
  config.company.domain = domain;
  const reach = stop(await p.select({
    message: 'Where will your team open databag?',
    options: [
      { value: 'domain', label: `On your domain, e.g. https://os.${domain}`, hint: 'reachable from anywhere; we show the DNS steps' },
      { value: 'local', label: 'Only on this computer and office network', hint: 'http://localhost:4100; you can add the domain later' },
    ],
    initialValue: config.company.url ? 'domain' : 'local',
  }));
  if (reach === 'domain') {
    const host = cleanDomain(stop(await p.text({ message: 'Which address?', initialValue: config.company.url ? cleanDomain(config.company.url) : `os.${domain}`, validate: (v) => (DOMAIN_RE.test(cleanDomain(v ?? '')) ? undefined : 'Enter an address like os.acme.com') })));
    config.company.url = `https://${host}`;
  } else delete config.company.url;

  // 2. Company name and logo.
  config.company.name = stop(await p.text({ message: 'Company name', initialValue: config.company.name === DEFAULTS.company.name ? domain.split('.')[0].replace(/^./, (c) => c.toUpperCase()) : config.company.name, validate: (v) => (v?.trim() ? undefined : 'Enter a name') })).trim();
  const logo = stop(await p.text({ message: 'Path to your logo (PNG, JPG or SVG). Leave empty to add it later in Settings. Tip: drag the file into this window.', placeholder: '~/Desktop/logo.png', defaultValue: '' }));
  if (logo?.trim()) {
    const file = path.resolve(logo.trim().replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ').replace(/^~(?=\/)/, os.homedir()));
    try { saveLogo(config, file); p.log.success('Logo saved.'); } catch (err) { p.log.warn(`${fs.existsSync(file) ? err.message : 'That file was not found.'} Add the logo later in Settings.`); }
  }

  // 3. The AI: Gemma 4 on this machine by default, or a hosted model with an API key.
  const where = stop(await p.select({
    message: 'Which AI should run your apps and agents?',
    options: [
      { value: 'local', label: `Gemma 4 on this computer (${LOCAL_MODEL})`, hint: 'free, private, about 10 GB download; fine on a 16 GB Mac Mini' },
      { value: 'openrouter', label: 'A hosted model through OpenRouter', hint: 'needs an API key; best on small machines' },
      { value: 'openai', label: 'OpenAI', hint: 'needs an API key' },
    ],
    initialValue: config.ai.baseUrl.includes('openrouter.ai') ? 'openrouter' : config.ai.baseUrl.includes('api.openai.com') ? 'openai' : 'local',
  }));
  if (where === 'local') {
    config.ai = { ...DEFAULTS.ai, ...(/11434/.test(config.ai.baseUrl) ? config.ai : {}), apiKey: undefined };
    const models = await localModels(config.ai.baseUrl);
    if (!models) p.log.warn('Ollama is not running. Install it from https://ollama.com (or run the one-line installer), then run:  databag model');
    else if (!models.includes(config.ai.model)) {
      const pull = stop(await p.confirm({ message: `Download ${config.ai.model} now? (about 10 GB, once)`, initialValue: true }));
      if (pull) await pullModel(config.ai.model);
    }
  } else {
    const name = where === 'openai' ? 'OpenAI' : 'OpenRouter';
    const key = stop(await p.password({ message: `Your ${name} API key. It is saved only in your databag settings file.`, validate: (v) => (v?.trim().length > 10 ? undefined : 'Paste the whole key') }));
    const model = stop(await p.text({ message: 'Which model? It must support tool calling.', initialValue: where === 'openai' ? 'gpt-4.1-mini' : 'google/gemini-2.5-flash' }));
    config.ai = { baseUrl: where === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1', model: model.trim(), apiKey: key.trim(), extraBody: {} };
  }

  // 4. Apps: everything by default.
  const all = stop(await p.confirm({ message: `Install all ${available.length} apps? (Mail, Calendar, Docs, CRM, Accounting, Agents, Value Factories…)`, initialValue: true }));
  config.apps = all ? available.map((a) => a.id) : stop(await p.multiselect({
    message: 'Which apps?', required: true,
    options: available.map((a) => ({ value: a.id, label: a.name, hint: `replaces ${a.replaces}` })),
    initialValues: config.apps.filter((id) => available.some((a) => a.id === id)),
  }));

  writeConfig(config);
  if (config.company.url) p.note(domainSteps(config), 'Point your domain at this computer');
  if (process.platform === 'darwin' && !args.includes('--no-service')) {
    const always = stop(await p.confirm({ message: 'Start databag automatically when this Mac starts?', initialValue: true }));
    if (always) serviceInstall();
  }
  p.outro(`Saved. ${process.platform === 'darwin' && fs.existsSync(PLIST) ? 'databag is starting; open' : 'Start it with:  databag start  and open'} http://localhost:${config.port} to create your account.`);
  return config;
}

/** The two simple ways to put databag on the company's own domain. */
function domainSteps(config) {
  const host = cleanDomain(config.company.url ?? `os.${config.company.domain}`);
  return [
    `Easiest (free, HTTPS included, no router changes): Cloudflare Tunnel.`,
    `  1. Add ${config.company.domain} to Cloudflare (free plan) and switch its nameservers at your domain provider.`,
    `  2. On this Mac:  brew install cloudflared`,
    `                   cloudflared tunnel login`,
    `                   cloudflared tunnel create databag`,
    `                   cloudflared tunnel route dns databag ${host}`,
    `                   cloudflared tunnel run --url http://localhost:${config.port} databag`,
    ``,
    `Or, with a fixed public IP: add an A record  ${host} → <your public IP>  at your domain provider,`,
    `forward port 443 to this Mac, and use  databag https <cert> <key> ${host}.`,
    ``,
    `Run  databag domain  to see these steps again.`,
  ].join('\n');
}
function domainCmd() {
  const config = readConfig();
  if (!config) { console.log('Run databag init first.'); process.exit(1); }
  if (!config.company.url) { console.log(`databag is set up for this computer only. Run  databag init  and choose "On your domain" to use ${config.company.domain}.`); return; }
  console.log(domainSteps(config));
}

/** macOS: run databag in the background and start it again after every restart. */
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', 'ai.databag.os.plist');
function serviceInstall() {
  if (process.platform !== 'darwin') { console.log('Automatic start is set up for macOS. On Linux use the Docker image or a systemd unit (see the docs).'); return; }
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.mkdirSync(path.join(HOME, 'logs'), { recursive: true });
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  fs.writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.databag.os</string>
  <key>ProgramArguments</key><array><string>${esc(process.execPath)}</string><string>${esc(path.join(ROOT, 'bin', 'databag.mjs'))}</string><string>start</string></array>
  <key>EnvironmentVariables</key><dict><key>DATABAG_HOME</key><string>${esc(HOME)}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${esc(path.join(HOME, 'logs', 'databag.log'))}</string>
  <key>StandardErrorPath</key><string>${esc(path.join(HOME, 'logs', 'databag.log'))}</string>
</dict></plist>
`);
  spawnSync('launchctl', ['unload', PLIST], { stdio: 'ignore' });
  spawnSync('launchctl', ['load', '-w', PLIST], { stdio: 'inherit' });
  console.log(`databag now starts with this Mac. Logs: ${path.join(HOME, 'logs', 'databag.log')}`);
}
function serviceRemove() {
  if (fs.existsSync(PLIST)) { spawnSync('launchctl', ['unload', '-w', PLIST], { stdio: 'inherit' }); fs.rmSync(PLIST); }
  console.log('databag no longer starts by itself.');
}
function service([what]) {
  if (what === 'install') serviceInstall();
  else if (what === 'remove') serviceRemove();
  else console.log('Usage: databag service install | remove');
}

/** Recreate the package links the production build expects (npm does not publish them). */
function linkExternals() {
  const list = path.join(ROOT, '.next', 'externals.json');
  if (!fs.existsSync(list)) return;
  const require = createRequire(path.join(ROOT, 'package.json'));
  const dir = path.join(ROOT, '.next', 'node_modules');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, pkg] of Object.entries(JSON.parse(fs.readFileSync(list, 'utf8')))) {
    const link = path.join(dir, name);
    if (fs.existsSync(link)) continue;
    let target;
    try { target = path.dirname(require.resolve(`${pkg}/package.json`)); }
    catch { try { let d = path.dirname(require.resolve(pkg)); while (path.basename(d) !== pkg && d !== path.dirname(d)) d = path.dirname(d); target = d; } catch { continue; } }
    try { fs.rmSync(link, { force: true }); fs.symlinkSync(target, link, 'dir'); } catch { /* read-only install: the build may still work */ }
  }
}

async function start(args) {
  const config = readConfig() ?? (await init(args));
  linkExternals();
  const require = createRequire(import.meta.url);
  const nextBin = path.join(path.dirname(require.resolve('next/package.json')), 'dist', 'bin', 'next');
  const built = fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID'));
  if (!built) console.log('databag: no production build found, starting in development mode (slower).');
  const tls = config.https && fs.existsSync(config.https.cert) && fs.existsSync(config.https.key) ? config.https : null;
  // With HTTPS, Next listens privately on the next port and a small HTTPS front door forwards to it.
  const appPort = tls ? config.port + 1 : config.port;
  const appHost = tls ? '127.0.0.1' : config.host;
  const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
  const child = spawn(process.execPath, [nextBin, built ? 'start' : 'dev', '-p', String(appPort), '-H', appHost], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, DATABAG_HOME: HOME, ...(process.env.DATABAG_URL ? {} : config.company?.url ? { DATABAG_URL: config.company.url } : tls ? { DATABAG_URL: `https://${tls.name || shown}:${config.port}` } : {}) },
  });
  if (tls) await httpsFrontDoor(tls, config.host, config.port, appPort);
  console.log(`databag: open ${tls ? 'https' : 'http'}://${tls?.name || shown}:${config.port}`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code) => process.exit(code ?? 0));
}

/** Serve HTTPS with the given certificate and pass every request on to the app. */
async function httpsFrontDoor(tls, host, port, appPort) {
  const https = await import('node:https');
  const http = await import('node:http');
  const server = https.createServer({ cert: fs.readFileSync(tls.cert), key: fs.readFileSync(tls.key) }, (req, res) => {
    const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': req.socket.remoteAddress ?? '', 'x-forwarded-host': req.headers.host ?? '' };
    const up = http.request({ host: '127.0.0.1', port: appPort, method: req.method, path: req.url, headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('databag is starting. Reload in a moment.'); });
    req.pipe(up);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, host, resolve));
}

/** Turn HTTPS on with a certificate (needed for the microphone on other computers), or off. */
function httpsCmd([cert, key, name]) {
  const config = readConfig();
  if (!config) { console.log('Run databag init first.'); process.exit(1); }
  if (cert === 'off') { delete config.https; writeConfig(config); console.log('HTTPS is off. databag serves plain http again.'); return; }
  if (!cert || !key || !fs.existsSync(cert) || !fs.existsSync(key)) {
    console.log(`Usage: databag https <certificate.pem> <key.pem> [host name]   or   databag https off

databag needs HTTPS to use the microphone from other computers (browsers only allow it on
https or on localhost). Two easy ways to get a certificate:

  Tailscale (works from anywhere, trusted automatically):
    tailscale cert <your-mac>.<tailnet>.ts.net
    databag https <your-mac>.<tailnet>.ts.net.crt <your-mac>.<tailnet>.ts.net.key <your-mac>.<tailnet>.ts.net

  mkcert (your office network; run "mkcert -install" on each computer that connects):
    brew install mkcert && mkcert -install
    mkcert databag.local 192.168.1.20
    databag https databag.local+1.pem databag.local+1-key.pem databag.local`);
    process.exit(cert ? 1 : 0);
  }
  config.https = { cert: path.resolve(cert), key: path.resolve(key), ...(name ? { name } : {}) };
  writeConfig(config);
  console.log(`HTTPS is on. Restart databag, then open https://${name || 'localhost'}:${config.port}`);
}

function apps() {
  const enabled = readConfig()?.apps ?? [];
  for (const a of CATALOG) {
    const state = a.status === 'planned' ? 'coming soon' : enabled.includes(a.id) ? 'installed' : 'available';
    console.log(`${a.name.padEnd(12)} ${state.padEnd(12)} replaces ${a.replaces}`);
  }
}

async function doctor() {
  const config = readConfig() ?? DEFAULTS;
  const models = await localModels(config.ai.baseUrl);
  const line = (ok, text) => console.log(`${ok ? '✓' : '✗'} ${text}`);
  line(Number(process.versions.node.split('.')[0]) >= 24, `Node ${process.versions.node} (needs 24 or newer)`);
  line(os.totalmem() >= 15 * 2 ** 30, `${Math.round(os.totalmem() / 2 ** 30)} GB memory (16 GB recommended)`);
  line(!!readConfig(), readConfig() ? `Settings at ${CONFIG}` : 'No settings yet — run: databag init');
  line(!!models, models ? `Local AI reachable at ${config.ai.baseUrl}` : `Local AI not reachable at ${config.ai.baseUrl}`);
  if (models) line(models.includes(config.ai.model), `Model ${config.ai.model} ${models.includes(config.ai.model) ? 'is installed' : 'is NOT installed'}`);
}

/** Download the local model through Ollama, showing its progress. */
function pullModel(model) {
  return new Promise((resolve) => {
    const child = spawn('ollama', ['pull', model], { stdio: 'inherit' });
    child.on('error', () => { console.log('Ollama is not installed. Get it from https://ollama.com, then run:  databag model'); resolve(false); });
    child.on('exit', (code) => resolve(code === 0));
  });
}
async function model([name]) {
  const m = name || readConfig()?.ai.model || DEFAULTS.ai.model;
  console.log(`databag: downloading ${m} through Ollama…`);
  process.exit((await pullModel(m)) ? 0 : 1);
}

/** Put a backup back in place. databag must be stopped; the current data is kept aside first. */
async function restore([from]) {
  const src = from && path.resolve(from);
  if (!src || !fs.existsSync(path.join(src, 'databag.db'))) {
    console.log('Usage: databag restore <backup folder>   (a folder named databag-YYYYMMDD-HHMMSS)');
    process.exit(1);
  }
  const port = readConfig()?.port ?? DEFAULTS.port;
  const running = await fetch(`http://127.0.0.1:${port}/login`).then(() => true, () => false);
  if (running) { console.log(`databag is still running on port ${port}. Stop it first, then run restore again.`); process.exit(1); }
  const aside = path.join(HOME, `before-restore-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`);
  fs.mkdirSync(aside, { recursive: true });
  for (const name of ['databag.db', 'databag.db-wal', 'databag.db-shm', 'config.json', 'files', 'sign'])
    if (fs.existsSync(path.join(HOME, name))) fs.renameSync(path.join(HOME, name), path.join(aside, name));
  fs.copyFileSync(path.join(src, 'databag.db'), path.join(HOME, 'databag.db'));
  if (fs.existsSync(path.join(src, 'config.json'))) fs.copyFileSync(path.join(src, 'config.json'), path.join(HOME, 'config.json'));
  for (const d of ['files', 'sign']) if (fs.existsSync(path.join(src, d))) fs.cpSync(path.join(src, d), path.join(HOME, d), { recursive: true });
  console.log(`Restored from ${src}.\nYour previous data is kept in ${aside}. Start databag again with: databag start`);
}

const [command, ...rest] = process.argv.slice(2);
const commands = { init, start, apps, doctor, restore, https: httpsCmd, model, domain: domainCmd, service };
if (!command) {
  // Plain "databag" (or "npx databag-os"): set up the first time, then run.
  if (!readConfig()) await init(rest);
  // Open the browser once databag has had a moment to start.
  if (process.platform === 'darwin' && process.stdout.isTTY) setTimeout(() => spawn('open', [`http://localhost:${readConfig().port}`], { stdio: 'ignore' }).on('error', () => {}), 6000).unref?.();
  if (!fs.existsSync(PLIST) || process.platform !== 'darwin') await start(rest);
  else console.log(`databag is running in the background: http://localhost:${readConfig().port}   (logs: ${path.join(HOME, 'logs', 'databag.log')})`);
} else if (commands[command]) await commands[command](rest);
else
  console.log(`databag: your company OS

  databag           set up (first time) and run
  databag init      answer the setup questions again (domain, logo, AI, apps)
  databag start     run everything (opens on http://localhost:4100)
  databag service   install | remove: start with this Mac (macOS)
  databag domain    show how to point your domain at this computer
  databag apps      list apps and what is installed
  databag doctor    check this machine is ready
  databag model     download the local AI model (Gemma 4) through Ollama
  databag https     serve over HTTPS with your own certificate
  databag restore   put a backup back (while databag is stopped)`);
