import { z } from 'zod';

export function formatWeight(value: string | null | undefined): string {
  if (value == null) return '—';
  const trimmed = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return value;
  const plain = trimmed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const negative = plain.startsWith('-');
  const unsigned = negative ? plain.slice(1) : plain;
  const [whole, fraction] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${fraction !== undefined ? `${grouped}.${fraction}` : grouped}`;
}

// Canonical API weights are decimal strings, never IEEE-754 quantities.
export const weightSchema = z.string().regex(/^(0|[1-9]\d{0,14})\.\d{3}$/);
export const positiveWeightSchema = weightSchema.refine((value) => value !== '0.000');

export function toMilligrams(value: string): bigint {
  if (!/^(0|[1-9]\d{0,14})\.\d{3}$/.test(value)) throw new Error('INVALID_WEIGHT');
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction);
}
export function fromMilligrams(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 1000n}.${String(absolute % 1000n).padStart(3, '0')}`;
}
export function normalizeWeightInput(input: string): string {
  const normalized = input
    .trim()
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (char) => String(char.charCodeAt(0) - 0x6f0))
    .replace('٫', '.');
  // Reject thousands separators and ambiguous commas instead of silently guessing.
  if (!/^\d{1,15}(\.\d{1,3})?$/.test(normalized)) throw new Error('INVALID_WEIGHT');
  const [whole, fraction = ''] = normalized.split('.');
  return weightSchema.parse(`${BigInt(whole)}.${fraction.padEnd(3, '0')}`);
}
