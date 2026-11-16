'use client';
import { z } from 'zod';
import {
  factorySettingsInputSchema,
  recipeApprovalSchema,
  recipeDisableSchema,
} from '@/contracts/settings';
import { settingsUi as s } from '@/locales/ar/settings';
import { useDurableWrite } from '../shared/use-durable-write';
const schema = z
  .object({
    key: z.uuid(),
    url: z.string(),
    method: z.enum(['POST', 'PATCH']),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((p, ctx) => {
    const valid =
      p.url === '/api/v1/settings' && p.method === 'PATCH'
        ? factorySettingsInputSchema.safeParse(p.payload).success
        : /^\/api\/v1\/catalog\/products\/[0-9a-f-]{36}\/recipes\/[0-9a-f-]{36}\/approve$/.test(
              p.url,
            ) && p.method === 'POST'
          ? recipeApprovalSchema.safeParse(p.payload).success
          : /^\/api\/v1\/catalog\/products\/[0-9a-f-]{36}\/recipes\/disable$/.test(p.url) &&
              p.method === 'POST'
            ? recipeDisableSchema.safeParse(p.payload).success
            : false;
    if (!valid) ctx.addIssue({ code: 'custom', message: 'Invalid configuration recovery request' });
  });
export function useConfigurationWrite(userId: string, onSaved: () => Promise<unknown>) {
  return useDurableWrite(userId, onSaved, {
    namespace: 'configuration',
    schema,
    saved: s.saved,
    loadError: s.loadError,
    errors: s.errors,
  });
}
