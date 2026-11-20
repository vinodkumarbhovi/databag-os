import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import nodemailer from 'nodemailer';
import { type Config, loadConfig } from '../config.ts';
import { get, run } from '../db.ts';

/**
 * Mail to the rest of the internet, two ways:
 * - direct: databag looks up the recipient's mail server (MX) and delivers to it itself,
 *   signed with the company's DKIM key, like any mail server. Needs outgoing port 25
 *   and the DNS records below (SPF, DKIM, DMARC).
 * - relay: hand the mail to an SMTP service (Resend, Postmark, Amazon SES, Gmail, your
 *   current provider). Best on home connections, where port 25 is usually blocked.
 * Either way the company's domain is proven to the world by DNS records the owner adds
 * at their domain provider; `checkDns` verifies them.
 */
export const SELECTOR = 'databag';
type Keys = { privateKey: string; publicKey: string; verify: string };

/** The company's DKIM key pair and domain-verification token, made once and kept in the database. */
export function mailKeys(): Keys {
  const row = get<{ value: string }>("SELECT value FROM app_kv WHERE key = 'mail_keys'");
  if (row) return JSON.parse(row.value);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const keys = { privateKey, publicKey, verify: crypto.randomBytes(16).toString('hex') };
  run("INSERT INTO app_kv (key, value) VALUES ('mail_keys', ?) ON CONFLICT(key) DO NOTHING", JSON.stringify(keys));
  return JSON.parse(get<{ value: string }>("SELECT value FROM app_kv WHERE key = 'mail_keys'")!.value);
}
const publicKeyBase64 = (pem: string) => pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

export type DnsRecord = { purpose: string; type: 'A' | 'MX' | 'TXT'; name: string; value: string; priority?: number; required: boolean };
export type DnsCheck = DnsRecord & { ok: boolean; found: string[] };

const hostOf = (url?: string) => { try { return url ? new URL(url).hostname : ''; } catch { return ''; } };

/** The records to add at the domain provider, filled in for this company. */
export function dnsRecords(config: Config = loadConfig(), ip?: string): DnsRecord[] {
  const domain = config.company.domain;
  const keys = mailKeys();
  const app = hostOf(config.company.url);
  const ipValue = ip || '<this machine\'s public IP address>';
  const relayHost = config.relay?.host ?? '';
  // Relays publish their own SPF include; the common ones are filled in, others are added by the owner.
  const include = /resend/.test(relayHost) ? ' include:amazonses.com' : /postmark/.test(relayHost) ? ' include:spf.mtasv.net' : /amazonaws|ses/.test(relayHost) ? ' include:amazonses.com' : /gmail|google/.test(relayHost) ? ' include:_spf.google.com' : '';
  return [
    { purpose: 'Proves you own the domain', type: 'TXT', name: domain, value: `databag-verify=${keys.verify}`, required: true },
    ...(app ? [{ purpose: 'Where your team opens databag', type: 'A' as const, name: app, value: ipValue, required: true }] : []),
    { purpose: 'Where mail for the domain is received', type: 'MX', name: domain, value: `mail.${domain}`, priority: 10, required: true },
    { purpose: 'The mail server\'s address', type: 'A', name: `mail.${domain}`, value: ipValue, required: true },
    { purpose: 'Which servers may send mail for the domain (SPF)', type: 'TXT', name: domain, value: `v=spf1 mx a:mail.${domain}${ip ? ` ip4:${ip}` : ''}${include} ~all`, required: true },
    { purpose: 'Signature that proves mail really came from you (DKIM)', type: 'TXT', name: `${SELECTOR}._domainkey.${domain}`, value: `v=DKIM1; k=rsa; p=${publicKeyBase64(keys.publicKey)}`, required: true },
    { purpose: 'What receivers do with mail that fails the checks (DMARC)', type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${domain}`, required: false },
  ];
}

/** This machine's public IP address, as the internet sees it. */
export async function publicIp(): Promise<string | null> {
  try {
    const text = await (await fetch('https://1.1.1.1/cdn-cgi/trace', { signal: AbortSignal.timeout(5000) })).text();
    return /^ip=(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  } catch { return null; }
}

/** Look every record up in public DNS (Cloudflare and Google), so the result is what the world sees. */
export async function checkDns(config: Config = loadConfig()): Promise<{ ip: string | null; records: DnsCheck[]; verified: boolean; ready: boolean }> {
  const ip = await publicIp();
  const resolver = new dns.Resolver({ timeout: 4000, tries: 2 });
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  const lookup = async (r: DnsRecord): Promise<string[]> => {
    try {
      if (r.type === 'A') return await resolver.resolve4(r.name);
      if (r.type === 'MX') return (await resolver.resolveMx(r.name)).map((m) => m.exchange.toLowerCase());
      return (await resolver.resolveTxt(r.name)).map((parts) => parts.join(''));
    } catch { return []; }
  };
  const records = await Promise.all(dnsRecords(config, ip ?? undefined).map(async (r): Promise<DnsCheck> => {
    const found = await lookup(r);
    const norm = (s: string) => s.replace(/\s+/g, '').replace(/\.$/, '').toLowerCase();
    let ok: boolean;
    if (r.type === 'A') ok = ip ? found.includes(ip) : found.length > 0;
    else if (r.type === 'TXT' && r.value.startsWith('v=spf1')) ok = found.some((f) => f.startsWith('v=spf1'));
    else if (r.type === 'TXT' && r.value.startsWith('v=DMARC1')) ok = found.some((f) => f.startsWith('v=DMARC1'));
    else ok = found.some((f) => norm(f) === norm(r.value));
    return { ...r, ok, found };
  }));
  return { ip, records, verified: records[0].ok, ready: records.filter((r) => r.required).every((r) => r.ok) };
}

export type OutMessage = { from: { name: string; address: string }; to: string[]; cc: string[]; recipients: string[]; subject: string; text: string; messageId: string; inReplyTo?: string };
export type OutResult = { to: string; status: 'relayed' | 'sent' | 'failed'; detail?: string };

let port25BlockedUntil = 0;
const BLOCKED = 'This network blocks outgoing port 25 (most home and many cloud networks do). Set up a relay in Settings → Mail, then send again.';
const dkim = (config: Config) => { const k = mailKeys(); return { domainName: config.company.domain, keySelector: SELECTOR, privateKey: k.privateKey }; };
const mailOptions = (m: OutMessage) => ({ envelope: { from: m.from.address, to: m.recipients }, messageId: m.messageId, inReplyTo: m.inReplyTo, from: m.from, to: m.to, cc: m.cc, subject: m.subject, text: m.text });

/** How mail leaves: 'relay' when one is set, otherwise 'direct' unless the owner turned sending off. */
export const outboundMode = (config: Config = loadConfig()): 'relay' | 'direct' | 'off' => (config.relay ? 'relay' : config.mail?.outbound === 'off' ? 'off' : 'direct');

/** Send to addresses outside the company. Never throws: each recipient gets a result. */
export async function sendOutbound(m: OutMessage): Promise<OutResult[]> {
  const config = loadConfig();
  const mode = outboundMode(config);
  if (mode === 'off') return m.recipients.map((to) => ({ to, status: 'failed', detail: 'Sending outside the company is turned off in Settings → Mail.' }));
  if (mode === 'relay') {
    try {
      const r = config.relay!;
      await nodemailer.createTransport({ host: r.host, port: r.port, secure: r.secure ?? r.port === 465, auth: r.user ? { user: r.user, pass: r.pass ?? '' } : undefined, dkim: dkim(config), connectionTimeout: 20_000 })
        .sendMail(mailOptions(m));
      return m.recipients.map((to) => ({ to, status: 'relayed' }));
    } catch (err) {
      return m.recipients.map((to) => ({ to, status: 'failed', detail: `The relay ${config.relay!.host} refused it: ${(err as Error).message}` }));
    }
  }
  // Direct: one delivery per recipient domain, to its best reachable mail server.
  // When port 25 turned out to be blocked, say so at once for a while instead of waiting again.
  if (Date.now() < port25BlockedUntil) return m.recipients.map((to) => ({ to, status: 'failed', detail: BLOCKED }));
  const byDomain = new Map<string, string[]>();
  for (const to of m.recipients) { const d = to.split('@')[1]; byDomain.set(d, [...(byDomain.get(d) ?? []), to]); }
  const results: OutResult[] = [];
  for (const [domain, rcpts] of byDomain) {
    let hosts: string[] = [];
    try { hosts = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((x) => x.exchange); } catch { /* fall back to the domain itself */ }
    if (config.mail?.mxOverride) hosts = [config.mail.mxOverride];
    if (!hosts.length) hosts = [domain];
    let error = '';
    for (const host of hosts.slice(0, 2)) {
      try {
        const [h, p] = host.split(':');
        await nodemailer.createTransport({
          host: h, port: Number(p) || 25, secure: false, name: `mail.${config.company.domain}`, dkim: dkim(config),
          tls: { rejectUnauthorized: false }, connectionTimeout: 8_000, greetingTimeout: 10_000, socketTimeout: 30_000,
        }).sendMail({ ...mailOptions(m), envelope: { from: m.from.address, to: rcpts } });
        error = '';
        results.push(...rcpts.map((to) => ({ to, status: 'sent' as const })));
        break;
      } catch (err) {
        const e = err as Error & { code?: string; responseCode?: number };
        const unreachable = e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'ESOCKET' || e.code === 'ECONNECTION';
        if (unreachable && !config.mail?.mxOverride) port25BlockedUntil = Date.now() + 10 * 60_000;
        error = unreachable
          ? `Could not reach ${domain}'s mail server on port 25. ${BLOCKED}`
          : e.responseCode && e.responseCode >= 500
            ? `${domain} rejected the message: ${e.message.slice(0, 200)}. Check the SPF and DKIM records in Settings → Domain, or use a relay.`
            : e.message.slice(0, 240);
      }
    }
    if (error) results.push(...rcpts.map((to) => ({ to, status: 'failed' as const, detail: error })));
  }
  return results;
}
