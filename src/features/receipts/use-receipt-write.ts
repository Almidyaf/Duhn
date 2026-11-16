'use client';
import { z } from 'zod';
import { receiptInputSchema, voidReceiptSchema } from '@/contracts/receipts';
import { receiptUi as r } from '@/locales/ar/receipts';
import { useDurableWrite } from '../shared/use-durable-write';
const schema = z
  .object({
    key: z.uuid(),
    url: z.string().regex(/^\/api\/v1\/receipts(?:\/[0-9a-f-]{36}\/void)?$/),
    method: z.literal('POST'),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((p, ctx) => {
    if (
      !(p.url.endsWith('/void') ? voidReceiptSchema : receiptInputSchema).safeParse(p.payload)
        .success
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid receipt recovery request' });
  });
export function useReceiptWrite(userId: string, onSaved: () => Promise<unknown>) {
  return useDurableWrite(userId, onSaved, {
    namespace: 'receipts',
    schema,
    saved: r.saved,
    loadError: r.loadError,
    errors: r.errors,
  });
}
