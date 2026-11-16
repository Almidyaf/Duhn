import { z } from 'zod';
import { expectedVersionSchema } from './requests';
export const factorySettingsInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA timezone'),
    week_starts_on: z.number().int().min(0).max(6),
    measurement_confirmed: z.literal(true),
    expected_version: expectedVersionSchema,
  })
  .strict();
export type FactorySettingsInput = z.infer<typeof factorySettingsInputSchema>;
export type FactorySettings = {
  id: string;
  name: string;
  timezone: string | null;
  week_starts_on: number | null;
  weight_precision: 3;
  configured: boolean;
  version: number;
  updated_at: string;
};
export const recipeApprovalSchema = z
  .object({
    expected_version: expectedVersionSchema,
    settings_version: expectedVersionSchema,
    note: z.string().trim().min(3).max(1000),
    process_confirmed: z.literal(true),
  })
  .strict();
export type RecipeApprovalInput = z.infer<typeof recipeApprovalSchema>;
export const recipeDisableSchema = z
  .object({ expected_version: expectedVersionSchema, reason: z.string().trim().min(3).max(1000) })
  .strict();
