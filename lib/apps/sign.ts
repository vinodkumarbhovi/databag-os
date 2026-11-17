import crypto from 'node:crypto';
import path from 'node:path';
import { type User, listUsers } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { sendMail } from '../mail/store.ts';
import { type Handlers, need } from '../rpc.ts';
import { publicUrl } from '../runtime.ts';
import { MAX_UPLOAD, putFile, readFile, removeFile } from '../storage.ts';

/**
 * PDF e-signature. A signer opens a private link, reads the PDF and types their
 * name. When everyone has signed, a certificate page is added to a copy of the
 * PDF: who signed, when, from where, and the fingerprint of the original file.
 */
type Doc = { id: string; owner_id: string; name: string; sha256: string; size: number; status: 'draft' | 'sent' | 'completed'; created_at: number; completed_at: number | null };
type Signer = { id: string; doc_id: string; name: string; email: string; token: string; signed_name: string | null; signed_at: number | null; ip: string | null };
const MAX_BYTES = Math.min(25 * 1024 * 1024, MAX_UPLOAD);
const original = (id: string) => `sign/${id}.pdf`;
const signedCopy = (id: string) => `sign/${id}.signed.pdf`;
const baseUrl = () => publicUrl(loadConfig().host, loadConfig().port);
const signersOf = (docId: string) => all<Signer>('SELECT * FROM sign_signers WHERE doc_id = ? ORDER BY created_at', docId);

export async function saveSignUpload(user: User, file: File): Promise<string> {
  need(file.size <= MAX_BYTES, `That file is larger than ${Math.round(MAX_BYTES / 1048576)} MB.`);
  const data = Buffer.from(await file.arrayBuffer());
  need(data.subarray(0, 5).toString('latin1') === '%PDF-', 'Only PDF files can be signed.');
  const id = crypto.randomUUID();
  putFile(original(id), data);
  run('INSERT INTO sign_docs (id, owner_id, name, sha256, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, user.id, (path.basename(file.name) || 'document.pdf').slice(0, 200), crypto.createHash('sha256').update(data).digest('hex'), data.length, Date.now());
  return id;
}

/** The PDF for someone allowed to see it: the owner, or a colleague asked to sign. */
export function readSignFile(user: User, id: string, signed: boolean): { name: string; data: Buffer } {
  const doc = get<Doc>('SELECT * FROM sign_docs WHERE id = ?', id);
  need(doc && (doc.owner_id === user.id || signersOf(id).some((s) => s.email === user.email.toLowerCase())), 'That document does not exist.');
  const file = signed && doc.status === 'completed' ? signedCopy(id) : original(id);
  const data = readFile(file);
  need(data, 'That file is missing.');
  return { name: signed && doc.status === 'completed' ? doc.name.replace(/\.pdf$/i, '') + ' (signed).pdf' : doc.name, data };
}

/** What a signing link shows. Returns nothing for an unknown link. */
export function byToken(token: string) {
  const signer = /^[a-f0-9]{48}$/.test(token) ? get<Signer>('SELECT * FROM sign_signers WHERE token = ?', token) : undefined;
  if (!signer) return null;
  const doc = get<Doc>('SELECT * FROM sign_docs WHERE id = ?', signer.doc_id)!;
  const owner = listUsers().find((u) => u.id === doc.owner_id);
  return { signer, doc, from: owner?.name ?? 'Someone', company: loadConfig().company.name };
}

export function readByToken(token: string): Buffer | null {
  const found = byToken(token);
  return found ? readFile(original(found.doc.id)) : null;
}

/** Add the certificate page once every signer has signed. */
async function finish(doc: Doc): Promise<void> {
  const signers = signersOf(doc.id);
  if (!signers.length || signers.some((s) => !s.signed_at)) return;
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.load(readFile(original(doc.id))!, { ignoreEncryption: true });
  const [plain, bold, script] = [await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold), await pdf.embedFont(StandardFonts.TimesRomanItalic)];
  // The built-in PDF fonts cover Western European text only; anything else becomes "?".
  const safe = (s: string) => [...s].map((ch) => { try { plain.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  let page = pdf.addPage([595, 842]);
  let y = 780;
  const line = (text: string, size = 10, font = plain, color = rgb(0.1, 0.1, 0.1)) => { page.drawText(safe(text), { x: 56, y, size, font, color }); y -= size + 8; };
  line('Signature certificate', 20, bold);
  y -= 6;
  line(`Document: ${doc.name}`);
  line(`Sent by: ${listUsers().find((u) => u.id === doc.owner_id)?.name ?? 'Unknown'}, ${loadConfig().company.name}`);
  line(`Fingerprint of the original file (SHA-256):`);
  line(doc.sha256, 8, plain, rgb(0.35, 0.35, 0.35));
  y -= 10;
  for (const s of signers) {
    if (y < 150) { page = pdf.addPage([595, 842]); y = 780; }
    page.drawLine({ start: { x: 56, y: y + 8 }, end: { x: 539, y: y + 8 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
    y -= 14;
    line(s.signed_name ?? '', 22, script, rgb(0.1, 0.15, 0.5));
    line(`Signed by ${s.signed_name} (${s.email})`, 10, bold);
    line(`Asked to sign as: ${s.name}`);
    line(`Date: ${new Date(s.signed_at!).toISOString().replace('T', ' ').slice(0, 19)} UTC`);
    line(`Network address: ${s.ip || 'not recorded'}`);
    y -= 8;
  }
  line('Signed with databag Sign. Each person signed by typing their name on a private link.', 8, plain, rgb(0.45, 0.45, 0.45));
  putFile(signedCopy(doc.id), await pdf.save());
  run("UPDATE sign_docs SET status = 'completed', completed_at = ? WHERE id = ?", Date.now(), doc.id);
  emit({ type: 'sign.completed', app: 'sign', userId: doc.owner_id, summary: `"${doc.name}" has been signed by everyone`, payload: { docId: doc.id } });
}

export async function signByToken(token: string, typedName: string, ip: string): Promise<void> {
  const found = byToken(token);
  need(found, 'This signing link is not valid.');
  need(!found.signer.signed_at, 'You have already signed this document.');
  const name = typedName?.trim().slice(0, 120);
  need(name && name.length >= 2, 'Type your full name to sign.');
  run('UPDATE sign_signers SET signed_name = ?, signed_at = ?, ip = ? WHERE id = ? AND signed_at IS NULL', name, Date.now(), ip.slice(0, 80), found.signer.id);
  emit({ type: 'sign.signed', app: 'sign', userId: found.doc.owner_id, summary: `${name} signed "${found.doc.name}"`, payload: { docId: found.doc.id } });
  await finish(found.doc);
}

function addSigner(docId: string, name: string, email: string): Signer {
  const s = { id: crypto.randomUUID(), token: crypto.randomBytes(24).toString('hex') };
  run('INSERT INTO sign_signers (id, doc_id, name, email, token, created_at) VALUES (?, ?, ?, ?, ?, ?)', s.id, docId, name.trim(), email.trim().toLowerCase(), s.token, Date.now());
  return get<Signer>('SELECT * FROM sign_signers WHERE id = ?', s.id)!;
}
const mine = (u: User, id: string): Doc => {
  const doc = get<Doc>('SELECT * FROM sign_docs WHERE id = ? AND owner_id = ?', id, u.id);
  need(doc, 'That document does not exist.');
  return doc;
};

export const sign: Handlers = {
  /** Documents I sent, and documents colleagues asked me to sign. */
  'sign.list': (u) => {
    const email = u.email.toLowerCase();
    return all<Doc>('SELECT * FROM sign_docs WHERE owner_id = ? OR id IN (SELECT doc_id FROM sign_signers WHERE email = ?) ORDER BY created_at DESC', u.id, email).map((d) => {
      const isMine = d.owner_id === u.id;
      return {
        id: d.id, name: d.name, status: d.status, created_at: d.created_at, mine: isMine, sha256: d.sha256,
        // Only the sender, and the signer themself, ever see a signing link.
        signers: signersOf(d.id).map((s) => ({ name: s.name, email: s.email, signed_at: s.signed_at, link: isMine || s.email === email ? `/sign/${s.token}` : null })),
      };
    });
  },

  /** Ask people to sign. Each gets an email with a private link; the links are also returned to copy. */
  'sign.request': async (u, { id, signers, message }: { id: string; signers: { name: string; email: string }[]; message?: string }) => {
    const doc = mine(u, id);
    need(doc.status !== 'completed', 'This document is already signed.');
    const people = (signers ?? []).filter((s) => s.name?.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email?.trim() ?? ''));
    need(people.length && people.length === signers.length, 'Every signer needs a name and an email address.');
    need(people.length <= 10, 'A document can have at most 10 signers.');
    const results = [];
    for (const p of people) {
      const s = addSigner(id, p.name, p.email);
      const link = `${baseUrl()}/sign/${s.token}`;
      const body = [`Hello ${s.name},`, '', `${u.name} from ${loadConfig().company.name} asks you to sign "${doc.name}".`, ...(message?.trim() ? ['', message.trim()] : []), '', `Read and sign it here: ${link}`, '', 'Thank you,', u.name].join('\n');
      let emailed = false;
      try { emailed = !(await sendMail(u, { to: [s.email], subject: `Please sign: ${doc.name}`, body })).delivery.some((d) => d.status === 'failed'); } catch { /* the link can still be shared by hand */ }
      results.push({ name: s.name, email: s.email, emailed, link: `/sign/${s.token}` });
    }
    run("UPDATE sign_docs SET status = 'sent' WHERE id = ?", id);
    emit({ type: 'sign.sent', app: 'sign', userId: u.id, summary: `You sent "${doc.name}" for signature`, payload: { docId: id } });
    return { results };
  },

  /** Sign a document yourself, right now. */
  'sign.signSelf': async (u, { id, name }: { id: string; name: string }) => {
    const doc = mine(u, id);
    need(doc.status !== 'completed', 'This document is already signed.');
    need(!signersOf(id).some((s) => s.email === u.email.toLowerCase()), 'You are already a signer of this document.');
    const s = addSigner(id, u.name, u.email);
    if (doc.status === 'draft') run("UPDATE sign_docs SET status = 'sent' WHERE id = ?", id);
    await signByToken(s.token, name, 'signed in to databag');
  },

  'sign.remove': (u, { id }: { id: string }) => {
    mine(u, id);
    run('DELETE FROM sign_signers WHERE doc_id = ?', id);
    run('DELETE FROM sign_docs WHERE id = ?', id);
    for (const f of [original(id), signedCopy(id)]) removeFile(f);
  },
};
