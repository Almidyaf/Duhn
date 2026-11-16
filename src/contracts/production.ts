import { z } from 'zod';
import { positiveWeightSchema } from './weight';
import { expectedVersionSchema } from './requests';
import type { Cursor, CatalogItem } from './catalog';
import type { ProcessingState } from './processing';

export const productionStartSchema = z
  .object({
    product_id: z.uuid(),
    raw_lot_id: z.uuid(),
    source_version: expectedVersionSchema,
    settings_version: expectedVersionSchema,
    quantity_g: positiveWeightSchema,
  })
  .strict();

export type ProductionStartInput = z.infer<typeof productionStartSchema>;

export type SourceChoice = {
  id: string;
  code: string;
  quantity_g: string;
  version: number;
  created_at: string;
};

export type ProductionOrderItem = {
  id: string;
  code: string;
  target_product_id: string;
  product_name: string;
  raw_product_id: string;
  raw_product_name: string;
  raw_lot_id: string;
  quantity_g: string;
  created_at: string;
  timezone: string;
  stage_id: string;
  stage_status: 'queued' | 'running' | 'paused' | 'completed';
  time_basis: 'active' | 'elapsed';
  paused_at: string | null;
  processing_state: ProcessingState | null;
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

export type ProductionPage = {
  items: ProductionOrderItem[];
  next_cursor: Cursor | null;
  server_time: string;
};

export type ProductionDetail = {
  order: ProductionOrderItem;
  server_time: string;
};

export type ProductionOptions = {
  product: CatalogItem;
  raw_product: CatalogItem;
  settings_version: number;
  timezone: string;
  sources: { items: SourceChoice[]; next_cursor: Cursor | null };
};
