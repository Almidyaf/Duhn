import { z } from 'zod';
import { weightSchema } from './weight';
import { expectedVersionSchema } from './requests';
export const processingSchema = z
  .object({
    action: z.enum([
      'pause_oven',
      'resume_oven',
      'complete_oven',
      'start_filter',
      'complete_filter',
      'start_packing',
      'complete_packing',
      'store',
      'sell',
    ]),
    expected_version: expectedVersionSchema,
    quantity_g: weightSchema.optional(),
    inspection_confirmed: z.literal(true).optional(),
    early_completion: z.boolean().optional(),
    note: z.string().trim().max(1000).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.action === 'pause_oven' && v.note.length < 3) ||
      (v.action === 'resume_oven' && !v.inspection_confirmed)
    )
      ctx.addIssue({ code: 'custom', message: 'Pause reason or resume inspection required' });
    if (
      v.action.startsWith('complete_') &&
      (!v.quantity_g || !v.inspection_confirmed || (v.quantity_g === '0.000' && v.note.length < 3))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Output and inspection required; zero output requires reason',
      });
  });
export type ProcessingInput = z.infer<typeof processingSchema>;
export type ProcessingState =
  | 'filter_queued'
  | 'filter_running'
  | 'packing_queued'
  | 'packing_running'
  | 'finished'
  | 'stored'
  | 'sold'
  | 'discarded';
