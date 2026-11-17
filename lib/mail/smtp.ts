import crypto from 'node:crypto';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { findUserByEmail } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { deliverLocal } from './store.ts';

const store = globalThis as typeof globalThis & { __databagSmtp?: SMTPServer };

/**
 * The inbound mail server. It accepts mail only for people who have an account
 * here, so it cannot be used to relay mail to anyone else.
 */
export function startSmtp(): void {
  if (store.__databagSmtp) return;
  const { smtp } = loadConfig();

  const server = new SMTPServer({
    name: 'databag',
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    size: 25 * 1024 * 1024,
    onRcptTo(address, _session, done) {
      if (findUserByEmail(address.address)) return done();
      done(Object.assign(new Error(`No mailbox here for ${address.address}`), { responseCode: 550 }));
    },
    onData(stream, session, done) {
      simpleParser(stream)
        .then((mail) => {
          const from = mail.from?.value[0];
          const list = (field: typeof mail.to) =>
            (Array.isArray(field) ? field : field ? [field] : []).flatMap((f) => f.value.map((v) => v.address ?? '')).filter(Boolean);
          for (const rcpt of session.envelope.rcptTo) {
            const user = findUserByEmail(rcpt.address);
            if (!user) continue;
            deliverLocal(user, {
              messageId: mail.messageId ?? `<${crypto.randomUUID()}@inbound>`,
              inReplyTo: mail.inReplyTo ?? null,
              from: { addr: from?.address ?? (session.envelope.mailFrom ? session.envelope.mailFrom.address : 'unknown'), name: from?.name ?? '' },
              to: list(mail.to),
              cc: list(mail.cc),
              subject: mail.subject ?? '',
              text: mail.text ?? '',
              html: typeof mail.html === 'string' ? mail.html : null,
              date: mail.date?.getTime(),
            });
          }
          done();
        })
        .catch((err) => done(err));
    },
  });

  server.on('error', (err) => console.error(`[databag mail] SMTP error: ${err.message}`));
  server.listen(smtp.port, smtp.host, () => console.log(`[databag mail] receiving mail on ${smtp.host}:${smtp.port}`));
  store.__databagSmtp = server;
}
