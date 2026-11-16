import { it, expect } from 'vitest';
import { formatWeight, normalizeWeightInput } from '../../src/contracts/weight';
import {
  formatGroupedWeight,
  formatLiveWeightInput,
  gramsToKgDisplay,
  parseGroupedWeightInput,
} from '../../src/components/weight-hint';
it('shows only significant fractional digits without rounding or losing large weights', () => {
  for (const [input, expected] of [
    ['980.000', '980'],
    ['980.250', '980.25'],
    ['0.001', '0.001'],
    ['1000.010', '1000.01'],
    ['999999999999999.999', '999999999999999.999'],
    ['-20.000', '-20'],
    ['0.000', '0'],
  ]) {
    expect(formatWeight(input)).toBe(expected);
    if (!input.startsWith('-')) expect(normalizeWeightInput(formatWeight(input))).toBe(input);
  }
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
