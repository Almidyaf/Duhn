'use client';
import { z } from 'zod';
import { receiptInputSchema, updateReceiptSchema, voidReceiptSchema } from '@/contracts/receipts';
import { receiptUi as r } from '@/locales/ar/receipts';
import { useDurableWrite, type Pending } from '../shared/use-durable-write';
const schema = z
  .object({
    key: z.uuid(),
    url: z.string().regex(/^\/api\/v1\/receipts(?:\/[0-9a-f-]{36}(?:\/void)?)?$/),
    method: z.enum(['POST', 'PATCH']),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((p, ctx) => {
    const isVoid = p.url.endsWith('/void');
    const isPatch = p.method === 'PATCH';
    const targetSchema = isVoid
      ? voidReceiptSchema
      : isPatch
        ? updateReceiptSchema
        : receiptInputSchema;
    if (!targetSchema.safeParse(p.payload).success)
      ctx.addIssue({ code: 'custom', message: 'Invalid receipt recovery request' });
  });
export function useReceiptWrite(
  userId: string,
  onSaved: (result?: unknown, request?: Pending) => Promise<unknown>,
) {
  return useDurableWrite(userId, onSaved, {
    namespace: 'receipts',
    schema,
    saved: r.saved,
    loadError: r.loadError,
    errors: r.errors,
  });
}
