'use client';
import { processingSchema } from '@/contracts/processing';
import { productionStartSchema } from '@/contracts/production';
import { z } from 'zod';
import {
  fermentationInputSchema,
  fermentationReadySchema,
  withdrawalInputSchema,
} from '@/contracts/fermentation';
import { productionUi as p } from '@/locales/ar/production';
import { ovenStartSchema } from '@/contracts/oven';
import { useDurableWrite } from '../shared/use-durable-write';
const schema = z
  .object({
    key: z.uuid(),
    url: z.string(),
    method: z.literal('POST'),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((v, ctx) => {
    const valid =
      v.url === '/api/v1/production-orders'
        ? productionStartSchema.safeParse(v.payload).success
        : v.url === '/api/v1/fermentations'
          ? fermentationInputSchema.safeParse(v.payload).success
        : /^\/api\/v1\/fermentations\/[0-9a-f-]{36}\/ready$/.test(v.url)
          ? fermentationReadySchema.safeParse(v.payload).success
          : /^\/api\/v1\/fermentations\/[0-9a-f-]{36}\/withdrawals$/.test(v.url)
            ? withdrawalInputSchema.safeParse(v.payload).success
            : /^\/api\/v1\/production-orders\/[0-9a-f-]{36}\/start$/.test(v.url)
              ? ovenStartSchema.safeParse(v.payload).success
              : /^\/api\/v1\/production-orders\/[0-9a-f-]{36}\/process$/.test(v.url)
                ? processingSchema.safeParse(v.payload).success
                : false;
    if (!valid) ctx.addIssue({ code: 'custom', message: 'Invalid production recovery request' });
  });
export function useProductionWrite(userId: string, onSaved: () => Promise<unknown>) {
  return useDurableWrite(userId, onSaved, {
    namespace: 'production',
    schema,
    saved: p.saved,
    loadError: p.loadError,
    errors: p.errors,
  });
}
