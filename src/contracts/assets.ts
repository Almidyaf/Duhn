import { z } from 'zod';
import { expectedVersionSchema } from './requests';

export const assetCategories = [
  'oven',
  'fermentation_vessel',
  'scale',
  'equipment',
  'other',
] as const;
export const assetInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    category: z.enum(assetCategories),
    location: z.string().trim().max(120).default(''),
    notes: z.string().trim().max(1000).default(''),
  })
  .strict();
export const assetUpdateSchema = assetInputSchema.extend({
  active: z.boolean(),
  expected_version: expectedVersionSchema,
});
export const assetDeleteSchema = z.object({ expected_version: expectedVersionSchema }).strict();
export type AssetDelete = z.infer<typeof assetDeleteSchema>;
export type AssetInput = z.infer<typeof assetInputSchema>;
export type AssetUpdate = z.infer<typeof assetUpdateSchema>;
export type Asset = AssetInput & {
  id: string;
  code: string;
  active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};
