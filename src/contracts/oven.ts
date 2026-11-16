import { z } from 'zod';
import { expectedVersionSchema } from './requests';
import type { Cursor } from './catalog';

export const ovenStartSchema = z
  .object({
    expected_version: expectedVersionSchema,
    asset_id: z.uuid(),
    asset_version: expectedVersionSchema,
    duration_minutes: z.number().int().min(1).max(525600),
  })
  .strict();
export type OvenStartInput = z.infer<typeof ovenStartSchema>;
export type OvenChoice = { id: string; name: string; version: number; created_at: string };
export type OvenChoices = { items: OvenChoice[]; next_cursor: Cursor | null };
