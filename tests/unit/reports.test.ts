import { it, expect } from 'vitest';
import { reportRange, reportRangeSchema, formatGrams } from '../../src/contracts/reports';
it('resolves calendar periods including leap years and configurable week starts', () => {
  expect(reportRange('month', '2024-02-15')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  expect(reportRange('quarter', '2026-11-06')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  expect(reportRange('half', '2026-05-20')).toEqual({ from: '2026-01-01', to: '2026-06-30' });
  expect(reportRange('year', '2026-11-06')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  expect(reportRange('week', '2026-11-06', undefined, 1)).toEqual({
    from: '2026-11-02',
    to: '2026-11-08',
  });
  expect(reportRange('week', '2026-11-06', undefined, 0)).toEqual({
    from: '2026-11-01',
    to: '2026-11-07',
  });
  expect(reportRangeSchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
  expect(reportRangeSchema.safeParse({ from: '2026-12-01', to: '2026-01-01' }).success).toBe(false);
});
it('formats aggregate weights without converting exact decimals to floating point', () => {
  expect(formatGrams('12345678901234567890.125')).toBe('12,345,678,901,234,567,890.125');
  expect(formatGrams('5000.000')).toBe('5,000');
});
