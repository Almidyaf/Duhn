import { randomUUID } from 'node:crypto';
import { getPool } from './db';
import { requireAssetAccess, type Member } from './members';
import { writeOnce } from './write-once';
import { AppError } from './errors';
import {
  factorySettingsInputSchema,
  recipeApprovalSchema,
  recipeDisableSchema,
  type FactorySettingsInput,
  type FactorySettings,
  type RecipeApprovalInput,
} from '../contracts/settings';
import type { PoolClient } from 'pg';
const settingsColumns = `id,name,timezone,week_starts_on,weight_precision,configured,version,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;
async function audit(
  client: PoolClient,
  member: Member,
  key: string,
  action: string,
  id: string,
  before: unknown,
  after: unknown,
) {
  await client.query(
    'INSERT INTO audit_events(id,actor_id,action,entity_id,before_value,after_value,request_key) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
    [randomUUID(), member.id, action, id, JSON.stringify(before), JSON.stringify(after), key],
  );
}
export async function getFactorySettings(member: Member) {
  requireAssetAccess(member);
  return (
    await getPool().query<FactorySettings>(
      `SELECT ${settingsColumns} FROM factory_settings WHERE singleton=true`,
    )
  ).rows[0];
}
export function updateFactorySettings(member: Member, key: string, input: FactorySettingsInput) {
  const parsed = factorySettingsInputSchema.parse(input);
  return writeOnce(
    member,
    key,
    'factory.settings.update',
    parsed,
    async (client) => {
      const before = (
        await client.query<FactorySettings>(
          `SELECT ${settingsColumns} FROM factory_settings WHERE singleton=true FOR UPDATE`,
        )
      ).rows[0];
      if (before.version !== parsed.expected_version) throw new AppError('VERSION_CONFLICT', 409);
      const timezone = await client.query('SELECT 1 FROM pg_timezone_names WHERE name=$1', [
        parsed.timezone,
      ]);
      if (!timezone.rowCount) throw new AppError('INVALID_TIMEZONE', 422);
      const after = (
        await client.query<FactorySettings>(
          `UPDATE factory_settings SET name=$1,timezone=$2,week_starts_on=$3,configured=true,version=version+1,updated_by=$4,updated_at=clock_timestamp() WHERE singleton=true RETURNING ${settingsColumns}`,
          [parsed.name, parsed.timezone, parsed.week_starts_on, member.id],
        )
      ).rows[0];
      await audit(client, member, key, 'factory.settings.updated', after.id, before, after);
      return after;
    },
    'owner',
  );
}
export function approveRecipe(
  member: Member,
  key: string,
  productId: string,
  recipeId: string,
  input: RecipeApprovalInput,
) {
  const parsed = recipeApprovalSchema.parse(input);
  return writeOnce(
    member,
    key,
    `recipe.approve:${productId}:${recipeId}`,
    parsed,
    async (client) => {
      // Settings, then types, then products: shared order for future batch-start commands.
      const settings = (
        await client.query<FactorySettings>(
          `SELECT ${settingsColumns} FROM factory_settings WHERE singleton=true FOR SHARE`,
        )
      ).rows[0];
      if (!settings.configured) throw new AppError('SETTINGS_REQUIRED', 409);
      if (settings.version !== parsed.settings_version) throw new AppError('VERSION_CONFLICT', 409);
      const recipe = (
        await client.query(
          'SELECT id,product_id,raw_product_id FROM recipe_versions WHERE id=$1 AND product_id=$2',
          [recipeId, productId],
        )
      ).rows[0];
      if (!recipe) throw new AppError('NOT_FOUND', 404);
      const identity = await client.query(
        'SELECT DISTINCT type_id FROM products WHERE id=ANY($1::uuid[]) ORDER BY type_id',
        [[productId, recipe.raw_product_id]],
      );
      const types = await client.query(
        'SELECT active FROM product_types WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
        [identity.rows.map((r) => r.type_id)],
      );
      const products = await client.query(
        'SELECT id,active,version FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [[productId, recipe.raw_product_id]],
      );
      const product = products.rows.find((p) => p.id === productId);
      if (types.rows.some((t) => !t.active) || products.rows.some((p) => !p.active))
        throw new AppError('INACTIVE_REFERENCE', 409);
      if (product.version !== parsed.expected_version) throw new AppError('VERSION_CONFLICT', 409);
      const previous = await client.query(
        'SELECT recipe_id FROM active_recipes WHERE product_id=$1',
        [productId],
      );
      if (previous.rows[0]?.recipe_id === recipeId) throw new AppError('ALREADY_ACTIVE', 409);
      await client.query(
        'INSERT INTO recipe_approvals(recipe_id,approved_by,approval_note,settings_snapshot) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',
        [recipeId, member.id, parsed.note, JSON.stringify(settings)],
      );
      await client.query(
        'INSERT INTO active_recipes(product_id,recipe_id) VALUES($1,$2) ON CONFLICT(product_id) DO UPDATE SET recipe_id=excluded.recipe_id',
        [productId, recipeId],
      );
      await client.query('UPDATE products SET version=version+1 WHERE id=$1', [productId]);
      const result = {
        recipe_id: recipeId,
        product_id: productId,
        product_version: product.version + 1,
        active: true,
      };
      await audit(
        client,
        member,
        key,
        'recipe.activated',
        recipeId,
        { previous_recipe_id: previous.rows[0]?.recipe_id ?? null },
        { ...result, note: parsed.note, settings_version: settings.version },
      );
      return result;
    },
    'owner',
  );
}
export function disableRecipe(member: Member, key: string, productId: string, input: unknown) {
  const parsed = recipeDisableSchema.parse(input);
  return writeOnce(
    member,
    key,
    `recipe.disable:${productId}`,
    parsed,
    async (client) => {
      const product = (
        await client.query('SELECT version FROM products WHERE id=$1 FOR UPDATE', [productId])
      ).rows[0];
      if (!product) throw new AppError('NOT_FOUND', 404);
      if (product.version !== parsed.expected_version) throw new AppError('VERSION_CONFLICT', 409);
      const previous = await client.query(
        'DELETE FROM active_recipes WHERE product_id=$1 RETURNING recipe_id',
        [productId],
      );
      if (!previous.rowCount) throw new AppError('NO_ACTIVE_RECIPE', 409);
      await client.query('UPDATE products SET version=version+1 WHERE id=$1', [productId]);
      const result = {
        recipe_id: previous.rows[0].recipe_id,
        product_id: productId,
        product_version: product.version + 1,
        active: false,
      };
      await audit(
        client,
        member,
        key,
        'recipe.disabled',
        result.recipe_id,
        { active: true },
        { ...result, reason: parsed.reason },
      );
      return result;
    },
    'owner',
  );
}
