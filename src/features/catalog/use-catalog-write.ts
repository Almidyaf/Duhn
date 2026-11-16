'use client';
import { z } from 'zod';
import { useDurableWrite, type Pending } from '../shared/use-durable-write';
import {
  catalogDeleteSchema,
  catalogEntitySchema,
  catalogInputSchemas,
  catalogUpdateSchemas,
  recipeInputSchema,
} from '@/contracts/catalog';
import { catalogUi as c } from '@/locales/ar/catalog';

const pendingSchema = z
  .object({
    key: z.uuid(),
    url: z
      .string()
      .regex(/^\/api\/v1\/catalog\/(types|products|suppliers)(\/[0-9a-f-]{36})?(\/recipes)?$/),
    method: z.enum(['POST', 'PATCH', 'DELETE']),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((p, ctx) => {
    const parts = p.url.split('/');
    const entity = catalogEntitySchema.parse(parts[4]);
    const recipe = parts[6] === 'recipes';
    const schema = recipe
      ? recipeInputSchema
      : p.method === 'DELETE'
        ? catalogDeleteSchema
        : p.method === 'PATCH'
          ? catalogUpdateSchemas[entity]
          : catalogInputSchemas[entity];
    if (
      !schema.safeParse(p.payload).success ||
      (recipe && (entity !== 'products' || p.method !== 'POST')) ||
      ((p.method === 'PATCH' || p.method === 'DELETE') && !parts[5])
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid saved request' });
  });
export function useCatalogWrite(
  userId: string,
  onSaved: (result?: unknown, request?: Pending) => Promise<unknown>,
) {
  return useDurableWrite(userId, onSaved, {
    namespace: 'catalog',
    schema: pendingSchema,
    saved: c.saved,
    loadError: c.loadError,
    errors: c.errors,
  });
}
export type CatalogWriter = ReturnType<typeof useCatalogWrite>;
