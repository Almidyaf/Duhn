import { z } from 'zod';
import { expectedVersionSchema } from './requests';

export const catalogEntitySchema = z.enum(['types', 'products', 'suppliers']);
export type CatalogEntity = z.infer<typeof catalogEntitySchema>;
export const catalogViewSchema = z.enum(['raw', 'finished', 'suppliers']);
export type CatalogView = z.infer<typeof catalogViewSchema>;
const name = z.string().trim().min(2).max(120);
export const typeInputSchema = z.object({ name }).strict();
export const productInputSchema = typeInputSchema
  .extend({
    kind: z.enum(['raw', 'finished']),
    raw_product_id: z.uuid().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'finished' && !v.raw_product_id) {
      ctx.addIssue({ code: 'custom', message: 'Raw material required', path: ['raw_product_id'] });
    }
    if (v.kind === 'raw' && v.raw_product_id) {
      ctx.addIssue({
        code: 'custom',
        message: 'Raw material cannot link to another raw material',
        path: ['raw_product_id'],
      });
    }
  });
export const supplierInputSchema = typeInputSchema.extend({
  contact: z.string().trim().max(120).default(''),
});
export const catalogInputSchemas = {
  types: typeInputSchema,
  products: productInputSchema,
  suppliers: supplierInputSchema,
};
const update = { active: z.boolean(), expected_version: expectedVersionSchema };
// Product kind is permanent. Oil (finished) links directly to a raw material (oud).
export const catalogUpdateSchemas = {
  types: typeInputSchema.extend(update),
  products: typeInputSchema.extend(update).extend({ raw_product_id: z.uuid().optional() }).strict(),
  suppliers: supplierInputSchema.extend(update),
};
export const catalogDeleteSchema = z.object({ expected_version: expectedVersionSchema }).strict();
export type CatalogDelete = z.infer<typeof catalogDeleteSchema>;
export type CatalogInput =
  | z.infer<typeof productInputSchema>
  | z.infer<typeof supplierInputSchema>
  | z.infer<typeof typeInputSchema>;
export type CatalogUpdate = {
  name: string;
  contact?: string;
  raw_product_id?: string;
  active: boolean;
  expected_version: number;
};
export type CatalogItem = {
  id: string;
  name: string;
  active: boolean;
  version: number;
  created_at: string;
  code?: string;
  type_id?: string | null;
  type_name?: string | null;
  kind?: 'raw' | 'finished';
  raw_product_id?: string | null;
  raw_product_name?: string | null;
  contact?: string;
};
export const cursorSchema = z.object({ id: z.uuid(), at: z.iso.datetime({ offset: true }) });
export type Cursor = z.infer<typeof cursorSchema>;
export type CatalogPage = { items: CatalogItem[]; next_cursor: Cursor | null };
export const catalogQuerySchema = z.object({
  q: z.string().trim().max(120).default(''),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  type_id: z.uuid().optional(),
  kind: z.enum(['raw', 'finished']).optional(),
  cursor: cursorSchema.optional(),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

const timingSchema = z
  .object({
    duration_minutes: z.number().int().min(1).max(525600),
    warning_minutes: z.number().int().min(0).max(525599),
    grace_minutes: z.number().int().min(0).max(10080),
    time_basis: z.enum(['active', 'elapsed']),
    resume_policy: z.enum(['continue', 'require_review']),
  })
  .strict()
  .refine((p) => p.warning_minutes < p.duration_minutes, {
    message: 'Warning must precede due time',
    path: ['warning_minutes'],
  });
export const recipeInputSchema = z
  .object({
    expected_version: expectedVersionSchema,
    raw_product_id: z.uuid(),
    policy: z.object({ fermentation: timingSchema, oven: timingSchema }).strict(),
    note: z.string().trim().max(1000).default(''),
  })
  .strict();
export type RecipeInput = z.infer<typeof recipeInputSchema>;
export type RecipeVersion = {
  id: string;
  product_id: string;
  revision: number;
  raw_product_id: string;
  product_snapshot: CatalogItem;
  raw_snapshot: CatalogItem;
  policy: RecipeInput['policy'];
  note: string;
  status: 'draft' | 'approved';
  active: boolean;
  created_at: string;
};
export type RecipePage = { items: RecipeVersion[]; next_cursor: Cursor | null };
