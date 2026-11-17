import { loadConfig } from '../config.ts';
import { all, get, run } from '../db.ts';
import { emit } from '../events.ts';
import { type Handlers, need } from '../rpc.ts';

type Inv = { number: string; customer_name: string; items: string; vat_rate: number; issued_at: number };
type Exp = { vendor: string; description: string; amount: number; vat: number; spent_at: number };
const round = (n: number) => Math.round(n * 100) / 100;

/** "2026-Q4" -> the first moment of the quarter and of the one after it. */
function bounds(period: string): [number, number] {
  const m = /^(\d{4})-Q([1-4])$/.exec(period);
  need(m, 'Unknown period.');
  return [new Date(+m[1], (+m[2] - 1) * 3, 1).getTime(), new Date(+m[1], +m[2] * 3, 1).getTime()];
}
const periodOf = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`; };

/** The VAT return for one quarter: what was charged on sent invoices, and what was paid on expenses. */
function figures(period: string) {
  const [from, to] = bounds(period);
  const sales = all<Inv>("SELECT number, customer_name, items, vat_rate, issued_at FROM acc_invoices WHERE kind = 'invoice' AND status != 'draft' AND issued_at >= ? AND issued_at < ? ORDER BY issued_at", from, to)
    .map((i) => {
      const net = round((JSON.parse(i.items) as { qty: number; price: number }[]).reduce((s, x) => s + x.qty * x.price, 0));
      return { number: i.number, customer: i.customer_name, date: i.issued_at, rate: i.vat_rate, net, vat: round((net * i.vat_rate) / 100) };
    });
  const purchases = all<Exp>('SELECT vendor, description, amount, vat, spent_at FROM acc_expenses WHERE spent_at >= ? AND spent_at < ? ORDER BY spent_at', from, to)
    .map((e) => ({ vendor: e.vendor, description: e.description, date: e.spent_at, net: e.amount, vat: e.vat }));
  const byRate = new Map<number, { rate: number; net: number; vat: number }>();
  for (const s of sales) {
    const row = byRate.get(s.rate) ?? { rate: s.rate, net: 0, vat: 0 };
    row.net = round(row.net + s.net); row.vat = round(row.vat + s.vat);
    byRate.set(s.rate, row);
  }
  const vatCharged = round(sales.reduce((s, x) => s + x.vat, 0));
  const vatPaid = round(purchases.reduce((s, x) => s + x.vat, 0));
  return {
    period, from, to, sales, purchases,
    rates: [...byRate.values()].sort((a, b) => b.rate - a.rate),
    salesNet: round(sales.reduce((s, x) => s + x.net, 0)), purchasesNet: round(purchases.reduce((s, x) => s + x.net, 0)),
    vatCharged, vatPaid, vatDue: round(vatCharged - vatPaid),
  };
}

export const tax: Handlers = {
  /** Every quarter from the first record up to now, newest first. */
  'tax.periods': () => {
    const first = get<{ t: number | null }>("SELECT MIN(t) AS t FROM (SELECT MIN(issued_at) AS t FROM acc_invoices WHERE kind = 'invoice' UNION ALL SELECT MIN(spent_at) FROM acc_expenses)")?.t ?? Date.now();
    const filed = new Map(all<{ period: string; filed_at: number }>('SELECT period, filed_at FROM tax_returns').map((r) => [r.period, r.filed_at]));
    const out: { period: string; filed_at: number | null; vatDue: number }[] = [];
    const d = new Date();
    for (let i = 0; i < 12; i++) {
      const period = periodOf(d.getTime());
      out.push({ period, filed_at: filed.get(period) ?? null, vatDue: figures(period).vatDue });
      if (bounds(period)[0] <= first) break;
      d.setMonth(d.getMonth() - 3);
    }
    return { currency: loadConfig().currency, periods: out };
  },

  'tax.return': (_u, { period }: { period: string }) => {
    const filed = get<{ filed_at: number; figures: string; by: string }>('SELECT r.filed_at, r.figures, u.name AS by FROM tax_returns r JOIN users u ON u.id = r.filed_by WHERE r.period = ?', period);
    return { ...figures(period), currency: loadConfig().currency, filed: filed ? { at: filed.filed_at, by: filed.by, vatDue: (JSON.parse(filed.figures) as { vatDue: number }).vatDue } : null };
  },

  /** Record that the return was filed, keeping the figures as they were on that day. */
  'tax.file': (u, { period }: { period: string }) => {
    const f = figures(period);
    need(f.to <= Date.now(), 'This quarter has not ended yet.');
    run('INSERT INTO tax_returns (period, filed_at, filed_by, figures) VALUES (?, ?, ?, ?) ON CONFLICT(period) DO UPDATE SET filed_at = excluded.filed_at, filed_by = excluded.filed_by, figures = excluded.figures',
      period, Date.now(), u.id, JSON.stringify({ vatCharged: f.vatCharged, vatPaid: f.vatPaid, vatDue: f.vatDue, salesNet: f.salesNet, purchasesNet: f.purchasesNet }));
    emit({ type: 'tax.filed', app: 'tax', userId: u.id, summary: `VAT return for ${period.replace('-', ' ')} marked as filed`, payload: { period } });
  },

  'tax.unfile': (_u, { period }: { period: string }) => {
    run('DELETE FROM tax_returns WHERE period = ?', period);
  },
};
