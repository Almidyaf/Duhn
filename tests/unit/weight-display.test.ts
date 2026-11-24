import { it, expect } from 'vitest';
import { formatWeight, normalizeWeightInput } from '../../src/contracts/weight';
import {
  formatGroupedWeight,
  formatLivePriceInput,
  formatLiveWeightInput,
  formatPrice,
  gramsToKgDisplay,
  parseGroupedPriceInput,
  parseGroupedWeightInput,
} from '../../src/components/weight-hint';
it('shows only significant fractional digits with 3-digit grouping without rounding or losing large weights', () => {
  for (const [input, expected] of [
    ['980.000', '980'],
    ['980.250', '980.25'],
    ['0.001', '0.001'],
    ['1000.010', '1,000.01'],
    ['2312323.000', '2,312,323'],
    ['999999999999999.999', '999,999,999,999,999.999'],
    ['-2000.000', '-2,000'],
    ['-20.000', '-20'],
    ['0.000', '0'],
  ]) {
    expect(formatWeight(input)).toBe(expected);
    if (!input.startsWith('-')) expect(parseGroupedWeightInput(formatWeight(input))).toBe(input);
  }
  expect(normalizeWeightInput('1000.01')).toBe('1000.010');
});

it('formats and parses prices with 3-digit commas cleanly', () => {
  expect(formatPrice('2312323.00')).toBe('2,312,323');
  expect(formatPrice('2312323.50')).toBe('2,312,323.5');
  expect(formatPrice('1500.25')).toBe('1,500.25');
  expect(formatPrice(null)).toBe('—');
  expect(formatLivePriceInput('2312323')).toBe('2,312,323');
  expect(formatLivePriceInput('2312323.5')).toBe('2,312,323.5');
  expect(formatLivePriceInput('٢٣١٢٣٢٣')).toBe('2,312,323');
  expect(parseGroupedPriceInput('2,312,323.50')).toBe('2312323.50');
});

it('parses strictly grouped 3-digit commas and formats kg equivalents accurately', () => {
  expect(parseGroupedWeightInput('50,000')).toBe('50000.000');
  expect(parseGroupedWeightInput('٥٠٬٠٠٠٫٢٥')).toBe('50000.250');
  expect(parseGroupedWeightInput('1,234,567.89')).toBe('1234567.890');
  expect(() => parseGroupedWeightInput('25,5')).toThrow();
  expect(() => parseGroupedWeightInput('1,23')).toThrow();
  expect(formatGroupedWeight('50000.000')).toBe('50,000');
  expect(formatGroupedWeight('1234.500')).toBe('1,234.5');
  expect(gramsToKgDisplay('50000.000')).toBe('50');
  expect(gramsToKgDisplay('1250.000')).toBe('1.25');
  expect(gramsToKgDisplay('500.000')).toBe('0.5');
  expect(gramsToKgDisplay('1.000')).toBe('0.001');
  expect(formatLiveWeightInput('5000')).toBe('5,000');
  expect(formatLiveWeightInput('50000')).toBe('50,000');
  expect(formatLiveWeightInput('1000000.25')).toBe('1,000,000.25');
  expect(formatLiveWeightInput('50000.')).toBe('50,000.');
  expect(formatLiveWeightInput('٥٠٠٠')).toBe('5,000');
});
