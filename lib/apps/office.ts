import crypto from 'node:crypto';
import { chat as ai } from '../ai.ts';
import { type User, listUsers } from '../auth.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { type Format, type Sheet, parseBook } from '../formula.ts';
import { type Handlers, need } from '../rpc.ts';

/** Docs, Sheets and Slides share one table. `content` is HTML, workbook JSON or deck JSON. */
export type Kind = 'doc' | 'sheet' | 'deck';
export type Slide = { title: string; body: string; notes?: string; image?: string; layout?: 'bullets' | 'title' };
export type Deck = { theme?: 'light' | 'dark' | 'brand'; slides: Slide[] };
type FileRow = { id: string; owner_id: string; kind: Kind; title: string; content: string; rev: number; updated_by: string | null; updated_at: number; created_at: number };

const EMPTY: Record<Kind, string> = { doc: '', sheet: '{"sheets":[{"name":"Sheet1","cells":{}}]}', deck: '{"theme":"light","slides":[{"title":"","body":""}]}' };
const LABEL: Record<Kind, string> = { doc: 'document', sheet: 'spreadsheet', deck: 'presentation' };
const APP: Record<Kind, string> = { doc: 'docs', sheet: 'sheets', deck: 'slides' };
const MAX_CONTENT = 12 * 1024 * 1024;
const VERSION_GAP = 10 * 60_000;
const nameOf = (id: string | null) => listUsers().find((u) => u.id === id)?.name ?? 'Someone';

// Who has each file open right now: the office_presence table, so it works across servers.

export function createFile(user: User, kind: Kind, title: string, content?: string): string {
  need(EMPTY[kind] !== undefined, 'Unknown file type.');
  const id = crypto.randomUUID();
  const now = Date.now();
  run('INSERT INTO office_files (id, owner_id, kind, title, content, updated_by, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, user.id, kind, title.trim() || `Untitled ${LABEL[kind]}`, content ?? EMPTY[kind], user.id, now, now);
  emit({ type: 'office.created', app: APP[kind], userId: user.id, summary: `You created the ${LABEL[kind]} "${title.trim() || 'Untitled'}"`, payload: { fileId: id } });
  return id;
}

export function getFile(id: string): FileRow {
  const file = get<FileRow>('SELECT * FROM office_files WHERE id = ?', id);
  need(file, 'That file does not exist.');
  return file;
}

/** Keep a copy of the file as it is now, so it can be restored later. */
function snapshot(file: FileRow, userId: string): void {
  run('INSERT INTO office_versions (id, file_id, title, content, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', crypto.randomUUID(), file.id, file.title, file.content, userId, Date.now());
  run('DELETE FROM office_versions WHERE file_id = ? AND id NOT IN (SELECT id FROM office_versions WHERE file_id = ? ORDER BY created_at DESC LIMIT 40)', file.id, file.id);
}

export const office: Handlers = {
  'office.list': (_u, { kind }: { kind?: Kind }) =>
    all(
      `SELECT f.id, f.kind, f.title, f.updated_at, u.name AS owner FROM office_files f JOIN users u ON u.id = f.owner_id
       ${kind ? 'WHERE f.kind = ?' : ''} ORDER BY f.updated_at DESC`,
      ...(kind ? [kind] : []),
    ),
  'office.get': (_u, { id }: { id: string }) => getFile(id),
  'office.create': (u, { kind, title }: { kind: Kind; title?: string }) => ({ id: createFile(u, kind, title ?? '') }),

  /**
   * Save changes. `rev` is the revision the editor started from: if someone else
   * saved since then, nothing is written and the caller is told who, unless `force`.
   */
  'office.save': (u, { id, title, content, rev, force }: { id: string; title?: string; content?: string; rev?: number; force?: boolean }) => {
    const file = getFile(id);
    if (rev !== undefined && rev !== file.rev && !force) return { conflict: true, by: nameOf(file.updated_by), rev: file.rev };
    need((content?.length ?? 0) <= MAX_CONTENT, 'This file is too large to save. Remove some images.');
    if (content !== undefined && content !== file.content) {
      const last = get<{ user_id: string; created_at: number }>('SELECT user_id, created_at FROM office_versions WHERE file_id = ? ORDER BY created_at DESC LIMIT 1', id);
      if (!last || Date.now() - last.created_at > VERSION_GAP || file.updated_by !== u.id) snapshot(file, file.updated_by ?? file.owner_id);
    }
    run('UPDATE office_files SET title = ?, content = ?, rev = rev + 1, updated_by = ?, updated_at = ? WHERE id = ?',
      title?.trim() || file.title, content ?? file.content, u.id, Date.now(), id);
    return { rev: file.rev + 1 };
  },

  /** Called every few seconds by an open editor: reports who else is here and any newer saved copy. */
  'office.sync': (u, { id, rev }: { id: string; rev: number }) => {
    const file = getFile(id);
    run('INSERT INTO office_presence (file_id, user_id, name, seen) VALUES (?, ?, ?, ?) ON CONFLICT(file_id, user_id) DO UPDATE SET seen = excluded.seen, name = excluded.name', id, u.id, u.name, Date.now());
    run('DELETE FROM office_presence WHERE seen < ?', Date.now() - 12_000);
    return {
      editors: all<{ name: string }>('SELECT name FROM office_presence WHERE file_id = ? AND user_id != ?', id, u.id).map((e) => e.name),
      file: file.rev > rev ? { ...file, by: nameOf(file.updated_by) } : null,
      comments: get<{ n: number }>('SELECT COUNT(*) AS n FROM office_comments WHERE file_id = ? AND resolved = 0', id)!.n,
    };
  },

  'office.remove': (_u, { id }: { id: string }) => {
    for (const t of ['office_versions', 'office_comments']) run(`DELETE FROM ${t} WHERE file_id = ?`, id);
    run('DELETE FROM office_files WHERE id = ?', id);
  },

  'office.versions': (_u, { id }: { id: string }) =>
    all('SELECT v.id, v.title, v.created_at, LENGTH(v.content) AS size, u.name AS by FROM office_versions v JOIN users u ON u.id = v.user_id WHERE v.file_id = ? ORDER BY v.created_at DESC', id),

  'office.restore': (u, { id, versionId }: { id: string; versionId: string }) => {
    const file = getFile(id);
    const v = get<{ title: string; content: string }>('SELECT title, content FROM office_versions WHERE id = ? AND file_id = ?', versionId, id);
    need(v, 'That version no longer exists.');
    snapshot(file, file.updated_by ?? file.owner_id); // so the restore itself can be undone
    run('UPDATE office_files SET title = ?, content = ?, rev = rev + 1, updated_by = ?, updated_at = ? WHERE id = ?', v.title, v.content, u.id, Date.now(), id);
  },

  'office.comments': (_u, { id }: { id: string }) =>
    all('SELECT c.id, c.quote, c.body, c.resolved, c.created_at, u.name AS by FROM office_comments c JOIN users u ON u.id = c.user_id WHERE c.file_id = ? ORDER BY c.resolved, c.created_at DESC', id),
  'office.addComment': (u, { id, body, quote }: { id: string; body: string; quote?: string }) => {
    getFile(id);
    need(body?.trim(), 'Write a comment first.');
    run('INSERT INTO office_comments (id, file_id, user_id, quote, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', crypto.randomUUID(), id, u.id, (quote ?? '').slice(0, 300), body.trim().slice(0, 4000), Date.now());
  },
  'office.resolveComment': (_u, { commentId, resolved }: { commentId: string; resolved: boolean }) => {
    run('UPDATE office_comments SET resolved = ? WHERE id = ?', resolved ? 1 : 0, commentId);
  },

  /** Docs: write new text, or rewrite the given text, from an instruction. */
  'office.aiWrite': async (_u, { instruction, text }: { instruction: string; text?: string }) => {
    need(instruction?.trim(), 'Tell the assistant what to write.');
    const out = await ai([
      { role: 'system', content: 'You are a writing assistant inside a word processor. Output only the text for the document: plain text, paragraphs separated by blank lines, no markdown, no commentary.' },
      { role: 'user', content: text?.trim() ? `Instruction: ${instruction}\n\nText to work on:\n${text.slice(0, 6000)}` : instruction },
    ], { maxTokens: 900 });
    return { text: out };
  },

  /** Slides: outline a deck on a topic. */
  'office.aiDeck': async (_u, { topic }: { topic: string }) => {
    need(topic?.trim(), 'Tell the assistant what the presentation is about.');
    const out = await ai([
      { role: 'system', content: 'Outline a presentation of 5 to 7 slides. Use exactly this format and nothing else: each slide starts with a line "# <slide title>" followed by 3 to 4 lines starting with "- " (short bullet points).' },
      { role: 'user', content: topic },
    ], { maxTokens: 900 });
    const slides: Slide[] = [];
    for (const line of out.split('\n')) {
      const title = line.match(/^#+\s*(.+)/);
      if (title) slides.push({ title: title[1].replace(/\*+/g, '').trim(), body: '' });
      else if (slides.length && line.trim()) slides[slides.length - 1].body += (slides[slides.length - 1].body ? '\n' : '') + line.replace(/^\s*[-*•]\s*/, '').trim();
    }
    need(slides.length, 'The assistant did not return a usable outline. Try again.');
    return { slides };
  },
};

// ---------- Word, Excel and PowerPoint files ----------
const NUM_FMT: Record<string, string> = { number: '#,##0.00', currency: '#,##0.00 [$€-x-euro2]', percent: '0.00%', date: 'yyyy-mm-dd' };
const THEMES = { light: { bg: 'FFFFFF', fg: '1A1A17', sub: '55554F' }, dark: { bg: '14141A', fg: 'F4F4F0', sub: 'B8B8B0' }, brand: { bg: '3B34A8', fg: 'FFFFFF', sub: 'DAD8F5' } };
export const parseDeck = (content: string): Deck => { try { const d = JSON.parse(content); if (d.slides?.length) return d; } catch { /* empty deck below */ } return { slides: [{ title: '', body: '' }] }; };

export async function exportFile(id: string): Promise<{ data: Uint8Array; name: string; mime: string }> {
  const file = getFile(id);
  const safe = file.title.replace(/[^\w .-]+/g, '').trim() || 'untitled';

  if (file.kind === 'doc') {
    const { default: htmlToDocx } = await import('html-to-docx');
    const html = `<!DOCTYPE html><html><body><h1>${file.title.replace(/</g, '&lt;')}</h1>${file.content || '<p></p>'}</body></html>`;
    const out = (await htmlToDocx(html, null, { table: { row: { cantSplit: true } } })) as ArrayBuffer;
    return { data: new Uint8Array(out), name: `${safe}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }

  if (file.kind === 'sheet') {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    for (const sheet of parseBook(file.content)) {
      const ws = wb.addWorksheet(sheet.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet');
      for (const [ref, raw] of Object.entries(sheet.cells)) {
        if (raw === '') continue;
        const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
        ws.getCell(ref).value = raw.trimStart().startsWith('=') ? { formula: raw.trim().slice(1) }
          : date ? new Date(Date.UTC(+date[1], +date[2] - 1, +date[3]))
          : raw.trim() !== '' && !isNaN(Number(raw)) ? Number(raw) : raw;
        if (date) ws.getCell(ref).numFmt = NUM_FMT.date;
      }
      for (const [ref, f] of Object.entries(sheet.formats ?? {})) {
        const cell = ws.getCell(ref);
        if (f.b || f.i) cell.font = { bold: !!f.b, italic: !!f.i };
        if (f.fmt) cell.numFmt = NUM_FMT[f.fmt];
        if (f.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${f.bg.replace('#', '').toUpperCase()}` } };
      }
    }
    return { data: new Uint8Array(await wb.xlsx.writeBuffer()), name: `${safe}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }

  const { default: Pptx } = await import('pptxgenjs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pptx = new ((Pptx as any).default ?? Pptx)();
  const deck = parseDeck(file.content);
  const theme = THEMES[deck.theme ?? 'light'] ?? THEMES.light;
  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: theme.bg };
    const lines = s.body.split('\n').filter((l) => l.trim());
    const image = s.image && /^data:image\/(png|jpe?g|gif);base64,/.test(s.image) ? s.image.slice(5) : null;
    const textW = image ? 4.6 : 9;
    if (s.layout === 'title') {
      slide.addText(s.title || ' ', { x: 0.5, y: 1.7, w: 9, h: 1.3, fontSize: 40, bold: true, align: 'center', color: theme.fg });
      if (lines.length) slide.addText(lines.join('\n'), { x: 0.5, y: 3.0, w: 9, h: 1, fontSize: 20, align: 'center', color: theme.sub });
    } else {
      slide.addText(s.title || ' ', { x: 0.5, y: 0.4, w: 9, h: 1, fontSize: 30, bold: true, color: theme.fg });
      if (lines.length) slide.addText(lines.map((text) => ({ text, options: { bullet: true, breakLine: true } })), { x: 0.5, y: 1.5, w: textW, h: 3.7, fontSize: 18, valign: 'top', color: theme.fg });
      if (image) slide.addImage({ data: image, x: 5.3, y: 1.5, w: 4.2, h: 3.5, sizing: { type: 'contain', w: 4.2, h: 3.5 } });
    }
    if (s.notes?.trim()) slide.addNotes(s.notes);
  }
  return { data: new Uint8Array((await pptx.write({ outputType: 'nodebuffer' })) as Buffer), name: `${safe}.pptx`, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
/** The text of each shape on a slide, read from its PresentationML. */
function shapesOf(xml: string): { kind: string; lines: string[] }[] {
  return (xml.match(/<p:sp[ >][\s\S]*?<\/p:sp>/g) ?? []).map((sp) => ({
    kind: /<p:ph[^>]*type="([^"]+)"/.exec(sp)?.[1] ?? (/<p:ph/.test(sp) ? 'body' : 'text'),
    lines: (sp.match(/<a:p[ >][\s\S]*?<\/a:p>/g) ?? []).map((p) => [...p.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => unxml(m[1])).join('')).filter((l) => l.trim()),
  }));
}

/** Turn an uploaded .docx, .xlsx or .pptx into an editable file. */
export async function importFile(user: User, name: string, data: Buffer): Promise<{ id: string; kind: Kind }> {
  const title = name.replace(/\.[^.]+$/, '');
  if (/\.docx$/i.test(name)) {
    const { default: mammoth } = await import('mammoth');
    const { value } = await mammoth.convertToHtml({ buffer: data });
    return { id: createFile(user, 'doc', title, value), kind: 'doc' };
  }
  if (/\.xlsx$/i.test(name)) {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(data as any);
    const sheets: Sheet[] = wb.worksheets.map((ws) => {
      const sheet: Sheet = { name: ws.name, cells: {}, formats: {} };
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          const v = cell.value as { formula?: string } | Date | null;
          sheet.cells[cell.address] = v instanceof Date ? v.toISOString().slice(0, 10) : v && typeof v === 'object' && 'formula' in v && v.formula ? `=${v.formula}` : cell.text;
          const f: Format = {};
          if (cell.font?.bold) f.b = 1;
          if (cell.font?.italic) f.i = 1;
          const nf = cell.numFmt ?? '';
          if (nf.includes('%')) f.fmt = 'percent';
          else if (/[$€£¥]/.test(nf)) f.fmt = 'currency';
          else if (/#,##0\.00|0\.00/.test(nf)) f.fmt = 'number';
          const fill = cell.fill as { type?: string; fgColor?: { argb?: string } } | undefined;
          if (fill?.type === 'pattern' && fill.fgColor?.argb) f.bg = `#${fill.fgColor.argb.slice(-6).toLowerCase()}`;
          if (Object.keys(f).length) sheet.formats![cell.address] = f;
        }),
      );
      return sheet;
    });
    return { id: createFile(user, 'sheet', title, JSON.stringify({ sheets: sheets.length ? sheets : [{ name: 'Sheet1', cells: {} }] })), kind: 'sheet' };
  }
  if (/\.pptx$/i.test(name)) {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(data);
    const n = (p: string) => Number(/(\d+)\.xml/.exec(p)![1]);
    const paths = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => n(a) - n(b));
    need(paths.length, 'No slides were found in that file.');
    const slides: Slide[] = [];
    for (const path of paths) {
      const shapes = shapesOf(await zip.file(path)!.async('string'));
      const titleShape = shapes.find((s) => s.kind === 'title' || s.kind === 'ctrTitle');
      const body = shapes.filter((s) => s !== titleShape && !['sldNum', 'dt', 'ftr'].includes(s.kind)).flatMap((s) => s.lines);
      const slide: Slide = { title: titleShape?.lines.join(' ') ?? body.shift() ?? '', body: body.join('\n') };
      const rels = await zip.file(path.replace('slides/', 'slides/_rels/') + '.rels')?.async('string');
      const notesPath = rels && /Target="\.\.\/(notesSlides\/[^"]+)"/.exec(rels)?.[1];
      const notesXml = notesPath ? await zip.file(`ppt/${notesPath}`)?.async('string') : undefined;
      if (notesXml) slide.notes = shapesOf(notesXml).filter((s) => s.kind === 'body').flatMap((s) => s.lines).join('\n');
      slides.push(slide);
    }
    return { id: createFile(user, 'deck', title, JSON.stringify({ theme: 'light', slides })), kind: 'deck' };
  }
  throw new Error('Only .docx, .xlsx and .pptx files can be opened.');
}
