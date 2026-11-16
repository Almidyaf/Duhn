import { z } from 'zod';
import { positiveWeightSchema } from './weight';
import { expectedVersionSchema } from './requests';
import type { Cursor, CatalogItem, RecipeVersion } from './catalog';
export const fermentationInputSchema = z
  .object({
    product_id: z.uuid(),
    recipe_id: z.uuid(),
    raw_lot_id: z.uuid(),
    source_version: expectedVersionSchema,
    settings_version: expectedVersionSchema,
    quantity_g: positiveWeightSchema,
    fermentation_duration_minutes: z.number().int().min(1).max(525600).optional(),
  })
  .strict();
export const fermentationReadySchema = z
  .object({ expected_version: expectedVersionSchema, inspection_confirmed: z.literal(true) })
  .strict();
export const withdrawalInputSchema = z
  .object({ expected_version: expectedVersionSchema, quantity_g: positiveWeightSchema })
  .strict();
export type FermentationInput = z.infer<typeof fermentationInputSchema>;
export type Fermentation = {
  id: string;
  code: string;
  target_product_id: string;
  product_name: string;
  raw_lot_id: string;
  recipe_id: string;
  recipe_revision: number;
  quantity_g: string;
  balance_g: string;
  status: 'fermenting' | 'ready' | 'depleted';
  version: number;
  created_at: string;
  started_at: string;
  due_at: string;
  completed_at: string | null;
  timezone: string;
  grace_minutes: number;
  warning_minutes: number;
  withdrawal_count: number;
};
export type ProductionOrder = {
  id: string;
  sequence_no: number;
  quantity_g: string;
  created_at: string;
  stage_id: string;
  stage_status: 'queued' | 'running' | 'paused' | 'completed';
  time_basis: 'active' | 'elapsed';
  paused_at: string | null;
  processing_state: import('./processing').ProcessingState | null;
  processing_version: number | null;
  available_g: string | null;
  oven_output_g: string | null;
  filter_output_g: string | null;
  packing_output_g: string | null;
  stage_version: number;
  started_at: string | null;
  due_at: string | null;
  duration_minutes: number;
  warning_minutes: number;
  grace_minutes: number;
  asset_name: string | null;
};
export type FermentationPage = {
  items: Fermentation[];
  next_cursor: Cursor | null;
  server_time: string;
};
export type FermentationDetail = {
  fermentation: Fermentation;
  orders: { items: ProductionOrder[]; next_cursor: Cursor | null };
  server_time: string;
};
export type SourceChoice = {
  id: string;
  code: string;
  quantity_g: string;
  version: number;
  created_at: string;
};
export type FermentationOptions = {
  product: CatalogItem;
  recipe: RecipeVersion;
  settings_version: number;
  timezone: string;
  sources: { items: SourceChoice[]; next_cursor: Cursor | null };
};
