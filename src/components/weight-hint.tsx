'use client';

import { formatWeight, fromMilligrams, normalizeWeightInput, toMilligrams } from '../contracts/weight';

const GROUPED_WEIGHT = /^\d{1,3}(?:[,٬]\d{3})+(?:\.\d{1,3})?$/;

export function formatLivePriceInput(raw: string): string {
  if (!raw) return '';
  const normalized = raw
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (char) => String(char.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, '.')
    .replace(/[,٬]/g, '');
  if (!/^\d*(?:\.\d{0,2})?$/.test(normalized)) return raw;
  const dotIndex = normalized.indexOf('.');
  const whole = dotIndex === -1 ? normalized : normalized.slice(0, dotIndex);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dotIndex === -1 ? grouped : `${grouped}.${normalized.slice(dotIndex + 1)}`;
}

export function parseGroupedPriceInput(input: string): string {
  if (!input) return '';
  return input
    .trim()
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (char) => String(char.charCodeAt(0) - 0x6f0))
    .replace('٫', '.')
    .replace(/[,٬]/g, '');
}

export function formatPrice(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  const str = String(raw).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(str)) return str;
  const plain = str.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const negative = plain.startsWith('-');
  const unsigned = negative ? plain.slice(1) : plain;
  const [whole, fraction] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${fraction !== undefined ? `${grouped}.${fraction}` : grouped}`;
}

export function formatLiveWeightInput(raw: string): string {
  if (!raw) return '';
  const normalized = raw
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (char) => String(char.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, '.')
    .replace(/[,٬]/g, '');
  if (!/^\d*(?:\.\d{0,3})?$/.test(normalized)) return raw;
  const dotIndex = normalized.indexOf('.');
  const whole = dotIndex === -1 ? normalized : normalized.slice(0, dotIndex);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dotIndex === -1 ? grouped : `${grouped}.${normalized.slice(dotIndex + 1)}`;
}

export function parseGroupedWeightInput(input: string): string {
  const normalized = input
    .trim()
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (char) => String(char.charCodeAt(0) - 0x6f0))
    .replace('٫', '.');
  const candidate = GROUPED_WEIGHT.test(normalized)
    ? normalized.replace(/[,٬]/g, '')
    : normalized;
  return normalizeWeightInput(candidate);
}

export function formatGroupedWeight(canonicalWeight: string): string {
  return formatWeight(canonicalWeight);
}

export function gramsToKgDisplay(canonicalWeight: string): string {
  const mg = toMilligrams(canonicalWeight);
  const kgWhole = mg / 1_000_000n;
  const kgFrac = mg % 1_000_000n;
  if (kgFrac === 0n) return `${kgWhole}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = String(kgFrac).padStart(6, '0').replace(/0+$/, '');
  return `${String(kgWhole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fracStr}`;
}

export function WeightHint({ value }: { value: string }) {
  if (!value.trim()) return null;
  let canonical: string;
  try {
    canonical = parseGroupedWeightInput(value);
  } catch {
    return null;
  }
  return (
    <small className="field-hint" dir="rtl">
      <bdi dir="ltr">{formatGroupedWeight(canonical)} جم</bdi> ={' '}
      <bdi dir="ltr">{gramsToKgDisplay(canonical)} كجم</bdi>
    </small>
  );
}

export function KgBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  try {
    if (toMilligrams(value) < 1_000_000n) return null;
    return (
      <small className="cell-subtitle" dir="rtl">
        <bdi dir="ltr">{gramsToKgDisplay(value)} كجم</bdi>
      </small>
    );
  } catch {
    return null;
  }
}

export { fromMilligrams, toMilligrams };
