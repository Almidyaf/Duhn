import { z } from 'zod';
import { positiveWeightSchema } from './weight';
import { expectedVersionSchema } from './requests';
import { cursorSchema, type Cursor } from './catalog';
const line = z
  .object({ product_id: z.uuid(), quantity_g: positiveWeightSchema })
  .strict();
export const receiptInputSchema = z
  .object({
    kind: z.enum(['purchase', 'opening']),
    supplier_id: z.uuid().nullable(),
    reference: z.string().trim().max(120).default(''),
    note: z.string().trim().max(1000).default(''),
    lines: z.array(line).min(1).max(25),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.kind === 'purchase' && !input.supplier_id)
      ctx.addIssue({ code: 'custom', message: 'Supplier required', path: ['supplier_id'] });
    if (input.kind === 'opening' && (input.supplier_id || input.note.length < 3 || input.reference))
      ctx.addIssue({
        code: 'custom',
        message: 'Opening balance requires a reason, no supplier or reference',
        path: ['note'],
      });
    if (new Set(input.lines.map((l) => l.product_id)).size !== input.lines.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate product', path: ['lines'] });
  });
export const voidReceiptSchema = z
  .object({ expected_version: expectedVersionSchema, reason: z.string().trim().min(3).max(1000) })
  .strict();
export const receiptQuerySchema = z.object({
  q: z.string().trim().max(120).default(''),
  status: z.enum(['all', 'posted', 'voided']).default('all'),
  cursor: cursorSchema.optional(),
});
export type ReceiptInput = z.infer<typeof receiptInputSchema>;
export type VoidReceiptInput = z.infer<typeof voidReceiptSchema>;
export type ReceiptQuery = z.infer<typeof receiptQuerySchema>;
export type Receipt = {
  id: string;
  code: string;
  kind: 'purchase' | 'opening';
  supplier_id: string | null;
  supplier_name: string | null;
  reference: string;
  note: string;
  status: 'posted' | 'voided';
  version: number;
  created_at: string;
  void_reason: string | null;
  voided_at: string | null;
  line_count: number;
  total_g: string;
};
export type ReceiptLine = {
  id: string;
  product_id: string;
  product_name: string;
  type_name: string;
  quantity_g: string;
  lot_id: string;
  lot_code: string;
  account_id: string;
  balance_g: string;
  balance_version: number;
};
export type ReceiptDetail = { receipt: Receipt; lines: ReceiptLine[] };
export type ReceiptPage = { items: Receipt[]; next_cursor: Cursor | null };
export type RawLot = {
  id: string;
  code: string;
  product_id: string;
  product_name: string;
  type_name: string;
  receipt_id: string;
  receipt_code: string;
  supplier_name: string | null;
  quantity_g: string;
  version: number;
  created_at: string;
};
export type RawLotPage = { items: RawLot[]; next_cursor: Cursor | null };
