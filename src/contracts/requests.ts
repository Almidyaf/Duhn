import { z } from 'zod';

export const idempotencyKeySchema = z.uuid();
export const expectedVersionSchema = z.number().int().positive().max(2147483647);

export type RequestOutcome<T> = { status: 'completed'; result: T } | { status: 'unknown' };

export function requireExpectedVersion(expected: number, actual: number) {
  if (expected !== actual) throw new Error('VERSION_CONFLICT');
}
