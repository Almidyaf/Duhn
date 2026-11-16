import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  catalogInputSchemas,
  catalogUpdateSchemas,
  catalogDeleteSchema,
  catalogQuerySchema,
  recipeInputSchema,
  type CatalogEntity,
  type CatalogItem,
  type CatalogInput,
  type CatalogUpdate,
  type CatalogDelete,
  type CatalogQuery,
  type RecipeInput,
  type RecipeVersion,
  type Cursor,
} from '../contracts/catalog';
import { getPool } from './db';
import { AppError } from './errors';
import { requireAssetAccess, type Member } from './members';
import { writeOnce } from './write-once';

// SQL identifiers only come from this static allowlist, never from request text.
const tables = { types: 'product_types', products: 'products', suppliers: 'suppliers' } as const;
const timestamp = `to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at`;
function columns(entity: CatalogEntity) {
  return (
    `id,name,active,version,${timestamp}` +
    (entity === 'products'
      ? ',code::text,type_id,kind,raw_product_id,(SELECT r.name FROM products r WHERE r.id=products.raw_product_id) AS raw_product_name'
      : entity === 'suppliers'
        ? ',contact'
        : '')
  );
}
const recipeColumns = `id,product_id,revision,raw_product_id,product_snapshot,raw_snapshot,policy,note,CASE WHEN EXISTS(SELECT 1 FROM recipe_approvals a WHERE a.recipe_id=recipe_versions.id) THEN 'approved' ELSE 'draft' END AS status,EXISTS(SELECT 1 FROM active_recipes a WHERE a.recipe_id=recipe_versions.id) AS active,${timestamp}`;
async function duplicateAsConflict<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new AppError('DUPLICATE_NAME', 409);
    throw error;
  }
}
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
    [
      randomUUID(),
      member.id,
      action,
      id,
      before === null ? null : JSON.stringify(before),
      JSON.stringify(after),
      key,
    ],
  );
}
export async function listCatalog(member: Member, entity: CatalogEntity, query: CatalogQuery) {
  requireAssetAccess(member);
  const input = catalogQuerySchema.parse(query);
  const values: unknown[] = [`%${input.q.replace(/[\\%_]/g, '\\$&')}%`];
  const clauses = ['name ILIKE $1'];
  if (input.status !== 'all') {
    values.push(input.status === 'active');
    clauses.push(`active=$${values.length}`);
  }
  if (entity === 'products') {
    if (input.type_id) {
      values.push(input.type_id);
      clauses.push(`type_id=$${values.length}`);
    }
    if (input.kind) {
      values.push(input.kind);
      clauses.push(`kind=$${values.length}`);
    }
  }
  if (input.cursor) {
    values.push(input.cursor.at, input.cursor.id);
    clauses.push(`(created_at,id) < ($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
  }
  const result = await getPool().query<CatalogItem>(
    `SELECT ${columns(entity)} FROM ${tables[entity]} WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT 26`,
    values,
  );
  const items = result.rows.slice(0, 25);
  const last = items.at(-1);
  return {
    items,
    next_cursor: result.rows.length > 25 && last ? { at: last.created_at, id: last.id } : null,
  };
}
export async function getCatalogItem(member: Member, entity: CatalogEntity, id: string) {
  requireAssetAccess(member);
  const result = await getPool().query<CatalogItem>(
    `SELECT ${columns(entity)} FROM ${tables[entity]} WHERE id=$1`,
    [id],
  );
  if (!result.rowCount) throw new AppError('NOT_FOUND', 404);
  return result.rows[0];
}
export function createCatalogItem(
  member: Member,
  key: string,
  entity: CatalogEntity,
  input: CatalogInput,
) {
  const parsed = catalogInputSchemas[entity].parse(input);
  return duplicateAsConflict(() =>
    writeOnce(member, key, `catalog.${entity}.create`, parsed, async (client) => {
      const rawProductId = 'raw_product_id' in parsed ? parsed.raw_product_id : undefined;
      if ('kind' in parsed && parsed.kind === 'finished' && rawProductId) {
        const raw = await client.query(
          "SELECT kind,active FROM products WHERE id=$1 FOR SHARE",
          [rawProductId],
        );
        if (!raw.rowCount || raw.rows[0].kind !== 'raw')
          throw new AppError('INVALID_PRODUCT_KIND', 422);
        if (!raw.rows[0].active) throw new AppError('INACTIVE_REFERENCE', 409);
      }
      const names = ['id', 'name', 'created_by'];
      const values: unknown[] = [randomUUID(), parsed.name, member.id];
      if ('kind' in parsed) {
        names.push('kind', 'raw_product_id');
        values.push(parsed.kind, parsed.kind === 'finished' ? rawProductId ?? null : null);
      }
      if ('contact' in parsed) {
        names.push('contact');
        values.push(parsed.contact);
      }
      const result = await client.query<CatalogItem>(
        `INSERT INTO ${tables[entity]}(${names.join(',')}) VALUES(${values.map((_, i) => `$${i + 1}`).join(',')}) RETURNING ${columns(entity)}`,
        values,
      );
      await audit(
        client,
        member,
        key,
        `catalog.${entity}.created`,
        result.rows[0].id,
        null,
        result.rows[0],
      );
      return result.rows[0];
    }),
  );
}
export function updateCatalogItem(
  member: Member,
  key: string,
  entity: CatalogEntity,
  id: string,
  input: CatalogUpdate,
) {
  const parsed = catalogUpdateSchemas[entity].parse(input);
  return duplicateAsConflict(() =>
    writeOnce(member, key, `catalog.${entity}.update:${id}`, parsed, async (client) => {
      const old = await client.query<CatalogItem>(
        `SELECT ${columns(entity)} FROM ${tables[entity]} WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!old.rowCount) throw new AppError('NOT_FOUND', 404);
      if (old.rows[0].version !== parsed.expected_version)
        throw new AppError('VERSION_CONFLICT', 409);
      const values: unknown[] = [id, parsed.name, parsed.active];
      let extra = '';
      if ('contact' in parsed) {
        values.push(parsed.contact);
        extra = ',contact=$4';
      }
      if (entity === 'products' && 'raw_product_id' in parsed && parsed.raw_product_id) {
        if (old.rows[0].kind !== 'finished') throw new AppError('INVALID_PRODUCT_KIND', 422);
        const raw = await client.query(
          'SELECT kind,active FROM products WHERE id=$1 FOR SHARE',
          [parsed.raw_product_id],
        );
        if (!raw.rowCount || raw.rows[0].kind !== 'raw')
          throw new AppError('INVALID_PRODUCT_KIND', 422);
        if (!raw.rows[0].active) throw new AppError('INACTIVE_REFERENCE', 409);
        values.push(parsed.raw_product_id);
        extra += `,raw_product_id=$${values.length}`;
      }
      const result = await client.query<CatalogItem>(
        `UPDATE ${tables[entity]} SET name=$2,active=$3,version=version+1${extra} WHERE id=$1 RETURNING ${columns(entity)}`,
        values,
      );
      await audit(
        client,
        member,
        key,
        `catalog.${entity}.updated`,
        id,
        old.rows[0],
        result.rows[0],
      );
      return result.rows[0];
    }),
  );
}
export function deleteCatalogItem(
  member: Member,
  key: string,
  entity: CatalogEntity,
  id: string,
  input: CatalogDelete,
) {
  const parsed = catalogDeleteSchema.parse(input);
  return writeOnce(member, key, `catalog.${entity}.delete:${id}`, parsed, async (client) => {
    const old = await client.query<CatalogItem>(
      `SELECT ${columns(entity)} FROM ${tables[entity]} WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (!old.rowCount) throw new AppError('NOT_FOUND', 404);
    if (old.rows[0].version !== parsed.expected_version)
      throw new AppError('VERSION_CONFLICT', 409);

    if (entity === 'products') {
      const ref = await client.query<{ used: boolean }>(
        `SELECT (
          EXISTS (SELECT 1 FROM products WHERE raw_product_id=$1)
          OR EXISTS (SELECT 1 FROM receipt_lines WHERE product_id=$1)
          OR EXISTS (SELECT 1 FROM material_lots WHERE product_id=$1)
          OR EXISTS (SELECT 1 FROM material_accounts WHERE product_id=$1)
          OR EXISTS (SELECT 1 FROM production_orders WHERE target_product_id=$1 OR raw_product_id=$1)
          OR EXISTS (SELECT 1 FROM stage_runs WHERE material_product_id=$1)
          OR EXISTS (SELECT 1 FROM fermentations WHERE target_product_id=$1 OR raw_product_id=$1)
          OR EXISTS (SELECT 1 FROM recipe_versions WHERE product_id=$1 OR raw_product_id=$1)
        ) AS used`,
        [id],
      );
      if (ref.rows[0]?.used) throw new AppError('ITEM_IN_USE', 409);
    } else if (entity === 'suppliers') {
      const ref = await client.query<{ used: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM receipts WHERE supplier_id=$1) AS used',
        [id],
      );
      if (ref.rows[0]?.used) throw new AppError('ITEM_IN_USE', 409);
    } else {
      const ref = await client.query<{ used: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM products WHERE type_id=$1) AS used',
        [id],
      );
      if (ref.rows[0]?.used) throw new AppError('ITEM_IN_USE', 409);
    }

    await audit(client, member, key, `catalog.${entity}.deleted`, id, old.rows[0], null);
    try {
      await client.query(`DELETE FROM ${tables[entity]} WHERE id=$1`, [id]);
    } catch (error) {
      if ((error as { code?: string })?.code === '23503')
        throw new AppError('ITEM_IN_USE', 409);
      throw error;
    }
    return { deleted: true as const, id };
  });
}
export async function listRecipes(member: Member, productId: string, cursor?: Cursor) {
  requireAssetAccess(member);
  const values: unknown[] = [productId];
  let clause = '';
  if (cursor) {
    values.push(cursor.at, cursor.id);
    clause = 'AND (created_at,id) < ($2::timestamptz,$3::uuid)';
  }
  const result = await getPool().query<RecipeVersion>(
    `SELECT ${recipeColumns} FROM recipe_versions WHERE product_id=$1 ${clause} ORDER BY created_at DESC,id DESC LIMIT 26`,
    values,
  );
  const items = result.rows.slice(0, 25);
  const last = items.at(-1);
  return {
    items,
    next_cursor: result.rows.length > 25 && last ? { at: last.created_at, id: last.id } : null,
  };
}
export function createRecipe(member: Member, key: string, productId: string, input: RecipeInput) {
  const parsed = recipeInputSchema.parse(input);
  return writeOnce(member, key, `recipe.create:${productId}`, parsed, async (client) => {
    // Lock hierarchy: types ordered by UUID, then products ordered by UUID. No type/kind reassignment.
    const identities = await client.query(
      'SELECT DISTINCT type_id FROM products WHERE id=ANY($1::uuid[]) ORDER BY type_id',
      [[productId, parsed.raw_product_id]],
    );
    const parents = await client.query(
      'SELECT id,active FROM product_types WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
      [identities.rows.map((r) => r.type_id)],
    );
    if (parents.rows.some((r) => !r.active)) throw new AppError('INACTIVE_REFERENCE', 409);
    const products = await client.query<CatalogItem>(
      `SELECT ${columns('products')} FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [[productId, parsed.raw_product_id]],
    );
    const target = products.rows.find((p) => p.id === productId);
    const raw = products.rows.find((p) => p.id === parsed.raw_product_id);
    if (!target || !raw) throw new AppError('NOT_FOUND', 404);
    if (target.kind !== 'finished' || raw.kind !== 'raw')
      throw new AppError('INVALID_PRODUCT_KIND', 422);
    if (!target.active || !raw.active) throw new AppError('INACTIVE_REFERENCE', 409);
    if (target.version !== parsed.expected_version) throw new AppError('VERSION_CONFLICT', 409);
    // The target row serializes revision assignment; UNIQUE remains a database backstop.
    const next = await client.query(
      'SELECT coalesce(max(revision),0)+1 AS revision FROM recipe_versions WHERE product_id=$1',
      [productId],
    );
    const result = await client.query<RecipeVersion>(
      `INSERT INTO recipe_versions(id,product_id,revision,raw_product_id,product_snapshot,raw_snapshot,policy,note,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9) RETURNING ${recipeColumns}`,
      [
        randomUUID(),
        productId,
        next.rows[0].revision,
        raw.id,
        JSON.stringify(target),
        JSON.stringify(raw),
        JSON.stringify(parsed.policy),
        parsed.note,
        member.id,
      ],
    );
    await client.query('UPDATE products SET version=version+1 WHERE id=$1', [productId]);
    await audit(
      client,
      member,
      key,
      'recipe.draft_created',
      result.rows[0].id,
      null,
      result.rows[0],
    );
    return { recipe: result.rows[0], product_version: target.version + 1 };
  });
}
