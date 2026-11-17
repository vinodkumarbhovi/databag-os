/**
 * The databag spreadsheet engine. Excel-style formulas: arithmetic, comparison,
 * text joining (&), ranges, references to other sheets (Sheet2!A1) and about
 * 75 functions. Written from the public behaviour of spreadsheets.
 */
export type Value = number | string | boolean;
export type Format = { b?: 1; i?: 1; fmt?: 'number' | 'currency' | 'percent' | 'date'; bg?: string };
export type Chart = { id: string; type: 'bar' | 'line' | 'pie'; range: string; title: string };
export type Sheet = { name: string; cells: Record<string, string>; formats?: Record<string, Format>; charts?: Chart[] };
type Res = Value | Value[][];
type Node = () => Res;

class FErr extends Error {}
const fail = (code: string): never => { throw new FErr(code); };

export function colName(i: number): string {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export function parseRef(ref: string): { col: number; row: number } {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref.toUpperCase());
  return m ? { col: colIndex(m[1]), row: Number(m[2]) } : fail('#REF!');
}
/** Every cell in a rectangle, as rows of references. */
export function rangeRefs(a: string, b: string): string[][] {
  const s = parseRef(a), e = parseRef(b);
  const r0 = Math.min(s.row, e.row), r1 = Math.max(s.row, e.row), c0 = Math.min(s.col, e.col), c1 = Math.max(s.col, e.col);
  if ((r1 - r0 + 1) * (c1 - c0 + 1) > 50_000) fail('#REF!');
  const rows: string[][] = [];
  for (let r = r0; r <= r1; r++) { const row: string[] = []; for (let c = c0; c <= c1; c++) row.push(`${colName(c)}${r}`); rows.push(row); }
  return rows;
}

// Dates are day numbers counted from 30 December 1899, as in other spreadsheets.
const EPOCH = Date.UTC(1899, 11, 30);
const toSerial = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 864e5);
const fromSerial = (n: number) => new Date(EPOCH + Math.floor(n) * 864e5);
const iso = (n: number) => fromSerial(n).toISOString().slice(0, 10);

/** What a typed (non-formula) cell means: a number, a date, TRUE/FALSE or text. */
export function literal(raw: string): Value {
  const t = raw.trim();
  if (t === '') return '';
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?%$/.test(t)) return Number(t.slice(0, -1)) / 100;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (date) return toSerial(+date[1], +date[2], +date[3]);
  return isNaN(Number(t)) ? raw : Number(t);
}

const scalar = (v: Res): Value => (Array.isArray(v) ? (v[0]?.[0] ?? '') : v);
const num = (r: Res): number => {
  const v = scalar(r);
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v.trim() === '') return 0;
  const n = Number(v);
  return isNaN(n) ? fail('#VALUE!') : n;
};
const str = (r: Res): string => { const v = scalar(r); return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v); };
const bool = (r: Res): boolean => {
  const v = scalar(r);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return /^true$/i.test(v) ? true : v === '' || /^false$/i.test(v) ? false : fail('#VALUE!');
};
const grid = (v: Res): Value[][] => (Array.isArray(v) ? v : [[v]]);
const flat = (args: Res[]): Value[] => args.flatMap((a) => (Array.isArray(a) ? a.flat() : [a]));
/** Numbers for SUM-style functions: ranges contribute only their numeric cells. */
const nums = (args: Res[]): number[] => args.flatMap((a) => (Array.isArray(a) ? a.flat().filter((v): v is number => typeof v === 'number') : [num(a)]));
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const sorted = (v: number[]) => [...v].sort((a, b) => a - b);
const same = (a: Value, b: Value) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);
const order = (a: Value, b: Value) => (typeof a === 'number' && typeof b === 'number' ? a - b : str(a).toLowerCase().localeCompare(str(b).toLowerCase()));

function compare(a: Value, b: Value, op: string): boolean {
  if (a === '' && typeof b === 'number') a = 0;
  if (b === '' && typeof a === 'number') b = 0;
  const c = typeof a === typeof b ? order(a, b) : typeof a === 'number' ? -1 : 1;
  return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
}

/** A SUMIF/COUNTIF condition such as ">10", "<>done" or "north*". */
function matcher(criterion: Value): (v: Value) => boolean {
  if (typeof criterion !== 'string') return (v) => v === criterion;
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(criterion)!;
  const op = m[1] ?? '=';
  const rhs = literal(m[2]);
  if (typeof rhs !== 'string') return (v) => (op === '<>' ? !(typeof v === typeof rhs && compare(v, rhs, '=')) : typeof v === typeof rhs && compare(v, rhs, op));
  const re = new RegExp(`^${rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return (v) => (op === '=' ? re.test(str(v)) : op === '<>' ? !re.test(str(v)) : typeof v === 'string' && v !== '' && compare(v, rhs, op));
}
function ifRange(args: Res[]): { test: Value[]; values: Value[] } {
  const test = grid(args[0]).flat();
  return { test, values: args[2] === undefined ? test : grid(args[2]).flat() };
}
function lookup(key: Value, list: Value[], exact: boolean): number {
  if (exact) return list.findIndex((v) => same(v, key));
  let hit = -1; // Sorted lookup: the last entry that is not greater than the key.
  for (let i = 0; i < list.length; i++) if (list[i] !== '' && typeof list[i] === typeof key && order(list[i], key) <= 0) hit = i;
  return hit;
}
const roundTo = (n: number, d: number, f: (x: number) => number) => { const p = 10 ** d; return f(n * p + (f === Math.round ? Math.sign(n) * 1e-9 : 0)) / p; };
const away = (x: number) => (x < 0 ? Math.floor(x) : Math.ceil(x));

export function formatText(n: number, f: string): string {
  if (/[ymd]/i.test(f) && !/[0#]/.test(f)) {
    const [y, m, d] = iso(n).split('-');
    return f.replace(/yyyy/i, y).replace(/yy/i, y.slice(2)).replace(/mm/i, m).replace(/dd/i, d);
  }
  const pct = f.includes('%');
  const dec = (f.split('.')[1]?.match(/0/g) ?? []).length;
  return (pct ? n * 100 : n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: f.includes(',') }) + (pct ? '%' : '');
}

const FN: Record<string, (a: Res[]) => Res> = {
  // Maths and statistics
  SUM: (a) => sum(nums(a)),
  AVERAGE: (a) => { const v = nums(a); return v.length ? sum(v) / v.length : fail('#DIV/0!'); },
  MIN: (a) => { const v = nums(a); return v.length ? Math.min(...v) : 0; },
  MAX: (a) => { const v = nums(a); return v.length ? Math.max(...v) : 0; },
  COUNT: (a) => flat(a).filter((v) => typeof v === 'number').length,
  COUNTA: (a) => flat(a).filter((v) => v !== '').length,
  COUNTBLANK: (a) => flat(a).filter((v) => v === '').length,
  PRODUCT: (a) => nums(a).reduce((x, y) => x * y, 1),
  MEDIAN: (a) => { const v = sorted(nums(a)); return v.length ? (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2 : fail('#NUM!'); },
  LARGE: (a) => sorted(nums([a[0]])).reverse()[num(a[1]) - 1] ?? fail('#NUM!'),
  SMALL: (a) => sorted(nums([a[0]]))[num(a[1]) - 1] ?? fail('#NUM!'),
  VAR: (a) => { const v = nums(a); if (v.length < 2) fail('#DIV/0!'); const m = sum(v) / v.length; return sum(v.map((x) => (x - m) ** 2)) / (v.length - 1); },
  STDEV: (a) => Math.sqrt(FN.VAR(a) as number),
  SUMPRODUCT: (a) => { const cols = a.map((x) => grid(x).flat()); return sum(cols[0].map((_, i) => cols.reduce((p, c) => p * (typeof c[i] === 'number' ? (c[i] as number) : 0), 1))); },
  SUMIF: (a) => { const { test, values } = ifRange(a); const ok = matcher(scalar(a[1])); return sum(test.map((v, i) => (ok(v) && typeof values[i] === 'number' ? (values[i] as number) : 0))); },
  COUNTIF: (a) => grid(a[0]).flat().filter(matcher(scalar(a[1]))).length,
  AVERAGEIF: (a) => { const { test, values } = ifRange(a); const ok = matcher(scalar(a[1])); const v = values.filter((x, i): x is number => ok(test[i]) && typeof x === 'number'); return v.length ? sum(v) / v.length : fail('#DIV/0!'); },
  ROUND: (a) => roundTo(num(a[0]), num(a[1] ?? 0), Math.round),
  ROUNDUP: (a) => roundTo(num(a[0]), num(a[1] ?? 0), away),
  ROUNDDOWN: (a) => roundTo(num(a[0]), num(a[1] ?? 0), Math.trunc),
  INT: (a) => Math.floor(num(a[0])),
  ABS: (a) => Math.abs(num(a[0])),
  SIGN: (a) => Math.sign(num(a[0])),
  MOD: (a) => { const d = num(a[1]); if (d === 0) fail('#DIV/0!'); const n = num(a[0]); return n - d * Math.floor(n / d); },
  POWER: (a) => num(a[0]) ** num(a[1]),
  SQRT: (a) => { const n = num(a[0]); return n < 0 ? fail('#NUM!') : Math.sqrt(n); },
  EXP: (a) => Math.exp(num(a[0])),
  LN: (a) => { const n = num(a[0]); return n <= 0 ? fail('#NUM!') : Math.log(n); },
  LOG10: (a) => { const n = num(a[0]); return n <= 0 ? fail('#NUM!') : Math.log10(n); },
  LOG: (a) => { const n = num(a[0]); return n <= 0 ? fail('#NUM!') : Math.log(n) / Math.log(num(a[1] ?? 10)); },
  PI: () => Math.PI,
  CEILING: (a) => { const s = num(a[1] ?? 1); return s === 0 ? 0 : Math.ceil(num(a[0]) / s) * s; },
  FLOOR: (a) => { const s = num(a[1] ?? 1); return s === 0 ? fail('#DIV/0!') : Math.floor(num(a[0]) / s) * s; },
  RAND: () => Math.random(),
  RANDBETWEEN: (a) => { const lo = Math.ceil(num(a[0])); return lo + Math.floor(Math.random() * (Math.floor(num(a[1])) - lo + 1)); },
  // Logic (IF, IFS, IFERROR and ISERROR are handled in the parser so unused branches never run)
  AND: (a) => flat(a).filter((v) => v !== '').every(bool),
  OR: (a) => flat(a).filter((v) => v !== '').some(bool),
  NOT: (a) => !bool(a[0]),
  TRUE: () => true,
  FALSE: () => false,
  ISBLANK: (a) => scalar(a[0]) === '',
  ISNUMBER: (a) => typeof scalar(a[0]) === 'number',
  ISTEXT: (a) => { const v = scalar(a[0]); return typeof v === 'string' && v !== ''; },
  // Lookup
  VLOOKUP: (a) => { const t = grid(a[1]); const i = lookup(scalar(a[0]), t.map((r) => r[0]), a[3] !== undefined && !bool(a[3])); return i < 0 ? fail('#N/A') : (t[i][num(a[2]) - 1] ?? fail('#REF!')); },
  HLOOKUP: (a) => { const t = grid(a[1]); const i = lookup(scalar(a[0]), t[0], a[3] !== undefined && !bool(a[3])); return i < 0 ? fail('#N/A') : (t[num(a[2]) - 1]?.[i] ?? fail('#REF!')); },
  XLOOKUP: (a) => { const i = lookup(scalar(a[0]), grid(a[1]).flat(), true); return i >= 0 ? (grid(a[2]).flat()[i] ?? fail('#REF!')) : a[3] !== undefined ? scalar(a[3]) : fail('#N/A'); },
  MATCH: (a) => { const i = lookup(scalar(a[0]), grid(a[1]).flat(), a[2] !== undefined && num(a[2]) === 0); return i < 0 ? fail('#N/A') : i + 1; },
  INDEX: (a) => { const t = grid(a[0]); const r = num(a[1]); const c = a[2] === undefined ? 1 : num(a[2]); return (t.length === 1 && a[2] === undefined ? t[0][r - 1] : t[r - 1]?.[c - 1]) ?? fail('#REF!'); },
  // Text
  CONCAT: (a) => flat(a).map(str).join(''),
  CONCATENATE: (a) => flat(a).map(str).join(''),
  TEXTJOIN: (a) => flat(a.slice(2)).filter((v) => !bool(a[1]) || v !== '').map(str).join(str(a[0])),
  LEFT: (a) => str(a[0]).slice(0, a[1] === undefined ? 1 : num(a[1])),
  RIGHT: (a) => { const n = a[1] === undefined ? 1 : num(a[1]); return n <= 0 ? '' : str(a[0]).slice(-n); },
  MID: (a) => str(a[0]).substr(num(a[1]) - 1, num(a[2])),
  LEN: (a) => str(a[0]).length,
  UPPER: (a) => str(a[0]).toUpperCase(),
  LOWER: (a) => str(a[0]).toLowerCase(),
  PROPER: (a) => str(a[0]).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, p, c) => p + c.toUpperCase()),
  TRIM: (a) => str(a[0]).trim().replace(/ +/g, ' '),
  FIND: (a) => { const i = str(a[1]).indexOf(str(a[0]), a[2] === undefined ? 0 : num(a[2]) - 1); return i < 0 ? fail('#VALUE!') : i + 1; },
  SEARCH: (a) => { const i = str(a[1]).toLowerCase().indexOf(str(a[0]).toLowerCase(), a[2] === undefined ? 0 : num(a[2]) - 1); return i < 0 ? fail('#VALUE!') : i + 1; },
  SUBSTITUTE: (a) => str(a[0]).split(str(a[1])).join(str(a[2])),
  REPT: (a) => str(a[0]).repeat(Math.max(0, Math.min(10_000, num(a[1])))),
  EXACT: (a) => str(a[0]) === str(a[1]),
  VALUE: (a) => { const v = literal(str(a[0])); return typeof v === 'number' ? v : fail('#VALUE!'); },
  TEXT: (a) => formatText(num(a[0]), str(a[1])),
  // Dates
  TODAY: () => { const d = new Date(); return toSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()); },
  NOW: () => { const d = new Date(); return toSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; },
  DATE: (a) => toSerial(num(a[0]), num(a[1]), num(a[2])),
  YEAR: (a) => fromSerial(num(a[0])).getUTCFullYear(),
  MONTH: (a) => fromSerial(num(a[0])).getUTCMonth() + 1,
  DAY: (a) => fromSerial(num(a[0])).getUTCDate(),
  WEEKDAY: (a) => fromSerial(num(a[0])).getUTCDay() + 1,
  DAYS: (a) => Math.floor(num(a[0])) - Math.floor(num(a[1])),
  EDATE: (a) => { const d = fromSerial(num(a[0])); return toSerial(d.getUTCFullYear(), d.getUTCMonth() + 1 + num(a[1]), d.getUTCDate()); },
  EOMONTH: (a) => { const d = fromSerial(num(a[0])); return toSerial(d.getUTCFullYear(), d.getUTCMonth() + 2 + num(a[1]), 0); },
};
export const FUNCTION_NAMES = [...Object.keys(FN), 'IF', 'IFS', 'IFERROR', 'ISERROR'].sort();

const TOKEN = /\s*(?:("(?:[^"]|"")*")|((?:[A-Za-z_][A-Za-z0-9_]*|'[^']+')!\$?[A-Za-z]{1,3}\$?\d+)|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|(\$?[A-Za-z]{1,3}\$?\d+(?![A-Za-z0-9_(]))|([A-Za-z_][A-Za-z0-9_.]*)|(<=|>=|<>|[-+*/^&=<>(),:%;]))/y;
type Tok = { t: 'str' | 'sref' | 'num' | 'ref' | 'id' | 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
    const m = TOKEN.exec(src);
    if (!m) fail('#ERROR!');
    const kinds = ['str', 'sref', 'num', 'ref', 'id', 'op'] as const;
    const k = kinds.findIndex((_, i) => m![i + 1] !== undefined);
    out.push({ t: kinds[k], v: m![k + 1] });
  }
  return out;
}

/** Returns a function that gives the value shown in any cell of the workbook. */
export function createEvaluator(book: Sheet[]): (sheet: number, ref: string) => Value {
  const cache = new Map<string, Value | FErr>();
  const visiting = new Set<string>();
  const sheetNamed = (name: string) => {
    const clean = name.replace(/^'|'$/g, '').toLowerCase();
    const i = book.findIndex((s) => s.name.toLowerCase() === clean);
    return i < 0 ? fail('#REF!') : i;
  };

  function cell(si: number, ref: string): Value {
    const key = `${si}!${ref}`;
    const hit = cache.get(key);
    if (hit !== undefined) { if (hit instanceof FErr) throw hit; return hit; }
    const raw = book[si].cells[ref] ?? '';
    if (!raw.trimStart().startsWith('=')) { const v = literal(raw); cache.set(key, v); return v; }
    if (visiting.has(key)) fail('#CYCLE!');
    visiting.add(key);
    try {
      const v = scalar(compile(raw.trim().slice(1), si)());
      const out = typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1e10) / 1e10 : fail('#NUM!')) : v;
      cache.set(key, out);
      return out;
    } catch (e) {
      const err = e instanceof FErr ? e : new FErr('#ERROR!');
      cache.set(key, err);
      throw err;
    } finally {
      visiting.delete(key);
    }
  }

  function compile(src: string, home: number): Node {
    const toks = tokenize(src);
    let i = 0;
    const peek = (v?: string) => (v === undefined ? toks[i] : toks[i]?.t === 'op' && toks[i].v === v ? toks[i] : undefined);
    const take = (v: string) => (peek(v) ? toks[i++] : fail('#ERROR!'));
    const binary = (next: () => Node, ops: string[], apply: (op: string, l: Res, r: () => Res) => Res): Node => {
      let left = next();
      while (toks[i]?.t === 'op' && ops.includes(toks[i].v)) {
        const op = toks[i++].v, l = left, r = next();
        left = () => apply(op, l(), r);
      }
      return left;
    };
    const comparison = (): Node => binary(joined, ['=', '<>', '<', '>', '<=', '>='], (op, l, r) => compare(scalar(l), scalar(r()), op));
    const joined = (): Node => binary(additive, ['&'], (_, l, r) => str(l) + str(r()));
    const additive = (): Node => binary(product, ['+', '-'], (op, l, r) => (op === '+' ? num(l) + num(r()) : num(l) - num(r())));
    const product = (): Node => binary(power, ['*', '/'], (op, l, r) => { const d = num(r()); return op === '*' ? num(l) * d : d === 0 ? fail('#DIV/0!') : num(l) / d; });
    const power = (): Node => binary(unary, ['^'], (_, l, r) => num(l) ** num(r()));
    const unary = (): Node => {
      if (peek('-')) { i++; const n = unary(); return () => -num(n()); }
      if (peek('+')) { i++; return unary(); }
      let n = primary();
      while (peek('%')) { i++; const inner = n; n = () => num(inner()) / 100; }
      return n;
    };
    const reference = (sheet: number, first: string): Node => {
      const a = first.replace(/\$/g, '').toUpperCase();
      if (peek(':') && toks[i + 1]?.t === 'ref') {
        const b = toks[i + 1].v.replace(/\$/g, '').toUpperCase();
        i += 2;
        return () => rangeRefs(a, b).map((row) => row.map((r) => cell(sheet, r)));
      }
      parseRef(a);
      return () => cell(sheet, a);
    };
    const primary = (): Node => {
      const t = toks[i++];
      if (!t) return fail('#ERROR!');
      if (t.t === 'num') { const n = Number(t.v); return () => n; }
      if (t.t === 'str') { const s = t.v.slice(1, -1).replace(/""/g, '"'); return () => s; }
      if (t.t === 'ref') return reference(home, t.v);
      if (t.t === 'sref') { const bang = t.v.lastIndexOf('!'); return reference(sheetNamed(t.v.slice(0, bang)), t.v.slice(bang + 1)); }
      if (t.t === 'op' && t.v === '(') { const n = comparison(); take(')'); return n; }
      if (t.t === 'id') {
        const name = t.v.toUpperCase();
        if (!peek('(')) return name === 'TRUE' ? () => true : name === 'FALSE' ? () => false : fail('#NAME?');
        i++;
        const args: Node[] = [];
        while (!peek(')')) {
          args.push(comparison());
          if (peek(',') || peek(';')) i++;
          else if (!peek(')')) fail('#ERROR!');
        }
        i++;
        if (name === 'IF') return () => (bool(args[0]()) ? (args[1]?.() ?? true) : (args[2]?.() ?? false));
        if (name === 'IFS') return () => { for (let k = 0; k + 1 < args.length; k += 2) if (bool(args[k]())) return args[k + 1](); return fail('#N/A'); };
        if (name === 'IFERROR') return () => { try { return scalar(args[0]()); } catch (e) { if (e instanceof FErr) return args[1]?.() ?? ''; throw e; } };
        if (name === 'ISERROR') return () => { try { args[0](); return false; } catch (e) { if (e instanceof FErr) return true; throw e; } };
        const fn = Object.hasOwn(FN, name) ? FN[name] : fail('#NAME?');
        return () => fn(args.map((a) => a()));
      }
      return fail('#ERROR!');
    };
    const root = comparison();
    if (i < toks.length) fail('#ERROR!');
    return root;
  }

  return (si, ref) => {
    try { return cell(si, ref); } catch (e) { return e instanceof FErr ? e.message : '#ERROR!'; }
  };
}

/** How a value appears in a cell, given its number format. */
export function display(v: Value, f: Format | undefined, currency: string): string {
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  switch (f?.fmt) {
    case 'number': return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'currency': return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(v);
    case 'percent': return `${(v * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
    case 'date': return iso(v);
    default: return v.toLocaleString(undefined, { maximumFractionDigits: 8 });
  }
}

/** Read stored spreadsheet content, including files saved by the first version (one sheet, no formats). */
export function parseBook(content: string): Sheet[] {
  try {
    const data = JSON.parse(content);
    if (Array.isArray(data.sheets) && data.sheets.length) return data.sheets;
    if (data.cells) return [{ name: 'Sheet1', cells: data.cells }];
  } catch { /* fall through to an empty workbook */ }
  return [{ name: 'Sheet1', cells: {} }];
}
