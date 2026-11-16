import { z } from 'zod';
export const reportRangeSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine(
    (v) => v.from <= v.to && Date.parse(v.to) - Date.parse(v.from) <= 3660 * 86400000,
    'Invalid report period',
  );
export type ReportRange = z.infer<typeof reportRangeSchema>;
export const reportPeriods = ['day', 'week', 'month', 'quarter', 'half', 'year', 'custom'] as const;
export type ReportPeriod = (typeof reportPeriods)[number];
export function reportRange(
  period: ReportPeriod,
  anchor: string,
  custom?: ReportRange,
  weekStart = 1,
): ReportRange {
  z.iso.date().parse(anchor);
  if (period === 'custom') return reportRangeSchema.parse(custom);
  const date = new Date(`${anchor}T12:00:00Z`),
    y = date.getUTCFullYear(),
    m = date.getUTCMonth();
  let from = date,
    to = date;
  if (period === 'week') {
    from = new Date(date);
    from.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - weekStart + 7) % 7));
    to = new Date(from);
    to.setUTCDate(from.getUTCDate() + 6);
  } else if (period !== 'day') {
    const size = period === 'month' ? 1 : period === 'quarter' ? 3 : period === 'half' ? 6 : 12;
    const start = Math.floor(m / size) * size;
    from = new Date(Date.UTC(y, start, 1, 12));
    to = new Date(Date.UTC(y, start + size, 0, 12));
  }
  return reportRangeSchema.parse({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });
}
export function formatGrams(value: string): string {
  const [whole, decimal = '000'] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${decimal === '000' ? '' : `.${decimal.replace(/0+$/, '')}`}`;
}
export type FactoryReport = {
  finishedInventory: {
    id: string;
    batch_id: string;
    name: string;
    sequence_no: number;
    quantity: string;
    state: string;
  }[];
  processing: {
    oven: string;
    filtered: string;
    packed: string;
    stored: string;
    sold: string;
    yield_percent: string;
    inventory: string;
    pending: string;
    in_process: string;
  };
  range: ReportRange;
  timezone: string;
  generatedAt: string;
  totals: {
    received: string;
    opening: string;
    reversed: string;
    fermented: string;
    withdrawn: string;
    receipts: number;
    batches: number;
    orders: number;
  };
  current: {
    raw: string;
    fermentation: string;
    oven: string;
    running: number;
    ready: number;
    late: number;
  };
  series: { day: string; quantity: string }[];
  products: { id: string; name: string; entered: string; withdrawn: string }[];
  operations: {
    id: string;
    code: string;
    name: string;
    quantity: string;
    status: string;
    due: string;
    orders: number;
  }[];
};
