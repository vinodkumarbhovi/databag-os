import { loadConfig, saveConfig } from '@/lib/config';
import { authed } from '@/lib/http';
import { checkDns, dnsRecords, outboundMode, publicIp } from '@/lib/mail/outbound';
import { sendMail } from '@/lib/mail/store';

const admin = (role: string) => { if (role !== 'admin') throw new Error('Only an admin can change the domain and mail settings.'); };

/** Domain and mail: the DNS records to add, where databag is reached, and how mail leaves. */
export const GET = authed(async ({ user }) => {
  admin(user.role);
  const c = loadConfig();
  const ip = await publicIp();
  return {
    domain: c.company.domain, url: c.company.url ?? '', ip, mode: outboundMode(c),
    relay: c.relay ? { host: c.relay.host, port: c.relay.port, user: c.relay.user ?? '', hasPass: !!c.relay.pass } : null,
    relayFromEnv: !!process.env.MAIL_RELAY_HOST,
    records: dnsRecords(c, ip ?? undefined),
  };
});

/** check: look the records up in public DNS. test: send a test email. */
export const POST = authed(async ({ req, user }) => {
  admin(user.role);
  const b = (await req.json()) as { action: 'check' | 'test'; to?: string };
  if (b.action === 'check') return checkDns();
  const to = b.to?.trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Enter the address to send the test to.');
  const r = await sendMail(user, { to: [to], subject: 'databag test email', body: `This is a test from ${loadConfig().company.name}'s databag. If you can read it, mail to the internet works.\n\n${user.name}` });
  return { delivery: r.delivery };
});

/** Save the public address, the relay, or turn direct sending on or off. */
export const PATCH = authed(async ({ req, user }) => {
  admin(user.role);
  const b = (await req.json()) as { url?: string; outbound?: 'direct' | 'off'; relay?: { host: string; port: number; user?: string; pass?: string } | null };
  const c = loadConfig();
  if (b.url !== undefined) {
    const url = b.url.trim().replace(/\/$/, '');
    if (url && !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) throw new Error('Use an address like https://os.acme.com');
    c.company.url = url || undefined;
  }
  if (b.outbound) c.mail = { ...c.mail, outbound: b.outbound };
  if (b.relay !== undefined) {
    if (process.env.MAIL_RELAY_HOST) throw new Error('The relay is set by environment variables on this server.');
    if (b.relay === null) delete c.relay;
    else {
      const host = b.relay.host?.trim();
      if (!host) throw new Error('Enter the relay’s server name, like smtp.resend.com.');
      c.relay = { host, port: Number(b.relay.port) || 587, user: b.relay.user?.trim() || undefined, pass: b.relay.pass || c.relay?.pass, secure: Number(b.relay.port) === 465 };
    }
  }
  saveConfig(c);
  return { ok: true, mode: outboundMode(c) };
});
