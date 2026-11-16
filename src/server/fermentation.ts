import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from './db';
import { writeOnce } from './write-once';
import { requireAssetAccess, type Member } from './members';
import { AppError } from './errors';
import { lockBalances, postMovement } from './material-ledger';
import {
  fermentationInputSchema,
  fermentationReadySchema,
  withdrawalInputSchema,
  type FermentationInput,
  type Fermentation,
  type FermentationDetail,
  type ProductionOrder,
  type SourceChoice,
} from '../contracts/fermentation';
import { toMilligrams } from '../contracts/weight';
import type { Cursor, RecipeVersion } from '../contracts/catalog';
import { getCatalogItem } from './catalog';
import { getFactorySettings } from './settings';
const date = (s: string) => `to_char(${s} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const columns = `f.id,f.code::text,f.target_product_id,p.name AS product_name,f.raw_lot_id,f.recipe_id,(f.recipe_snapshot->>'revision')::int AS recipe_revision,f.quantity_g::numeric(18,3)::text,b.quantity_g::text AS balance_g,f.status,f.version,${date('f.created_at')} AS created_at,${date('s.started_at')} AS started_at,${date('s.due_at')} AS due_at,${date('s.completed_at')} AS completed_at,f.settings_snapshot->>'timezone' AS timezone,(s.policy->>'grace_minutes')::int AS grace_minutes,(s.policy->>'warning_minutes')::int AS warning_minutes,f.withdrawal_count`;
const joins = `FROM fermentations f JOIN products p ON p.id=f.target_product_id JOIN material_accounts a ON a.fermentation_id=f.id JOIN material_balances b ON b.account_id=a.id JOIN stage_runs s ON s.fermentation_id=f.id`;
async function detail(
  client: Pick<PoolClient, 'query'>,
  id: string,
  cursor?: Cursor,
): Promise<FermentationDetail> {
  const values: unknown[] = [id];
  let clause = '';
  if (cursor) {
    values.push(cursor.at, cursor.id);
    clause = 'AND (o.created_at,o.id)<($2::timestamptz,$3::uuid)';
  }
  const result = await client.query<{
    fermentation: Fermentation;
    orders: ProductionOrder[];
    server_time: string;
  }>(
    `SELECT to_jsonb(fx) AS fermentation,${date('clock_timestamp()')} AS server_time,coalesce((SELECT jsonb_agg(to_jsonb(ox) ORDER BY ox.created_at DESC,ox.id DESC) FROM (SELECT o.id,o.sequence_no,o.quantity_g::numeric(18,3)::text,${date('o.created_at')} AS created_at,s.id AS stage_id,CASE WHEN EXISTS(SELECT FROM oven_pauses WHERE order_id=o.id AND ended_at IS NULL) THEN 'paused' ELSE s.status END AS stage_status,(SELECT started_at FROM oven_pauses WHERE order_id=o.id AND ended_at IS NULL) AS paused_at,s.version AS stage_version,${date('s.started_at')} AS started_at,${date('s.due_at')} AS due_at,(s.policy->>'duration_minutes')::int AS duration_minutes,(s.policy->>'warning_minutes')::int AS warning_minutes,(s.policy->>'grace_minutes')::int AS grace_minutes,s.policy->>'time_basis' AS time_basis,s.asset_snapshot->>'name' AS asset_name,op.state AS processing_state,op.version AS processing_version,pb.quantity_g::text AS available_g,
(SELECT output_g::text FROM processing_results WHERE order_id=o.id AND kind='oven') AS oven_output_g,
(SELECT output_g::text FROM processing_results WHERE order_id=o.id AND kind='filter') AS filter_output_g,
(SELECT output_g::text FROM processing_results WHERE order_id=o.id AND kind='packing') AS packing_output_g
FROM production_orders o JOIN stage_runs s ON s.production_order_id=o.id LEFT JOIN order_processing op ON op.order_id=o.id LEFT JOIN material_accounts pa ON pa.production_order_id=o.id LEFT JOIN material_balances pb ON pb.account_id=pa.id WHERE o.fermentation_id=$1 ${clause} ORDER BY o.created_at DESC,o.id DESC LIMIT 26) ox),'[]'::jsonb) AS orders FROM (SELECT ${columns} ${joins} WHERE f.id=$1) fx`,
    values,
  );
  if (!result.rowCount) throw new AppError('NOT_FOUND', 404);
  const row = result.rows[0];
  const orders = row.orders.slice(0, 25);
  const last = orders.at(-1);
  return {
    ...row,
    orders: {
      items: orders,
      next_cursor: row.orders.length > 25 && last ? { at: last.created_at, id: last.id } : null,
    },
  };
}
async function event(
  client: PoolClient,
  member: Member,
  key: string,
  topic: string,
  id: string,
  data: unknown,
) {
  await client.query(
    'INSERT INTO audit_events(id,actor_id,action,entity_id,after_value,request_key) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
    [randomUUID(), member.id, topic, id, JSON.stringify(data), key],
  );
  await client.query(
    'INSERT INTO outbox_events(id,topic,entity_id,payload) VALUES($1,$2,$3,$4::jsonb)',
    [randomUUID(), topic, id, JSON.stringify(data)],
  );
}
export async function fermentationOptions(member: Member, productId: string, cursor?: Cursor) {
  requireAssetAccess(member);
  const [product, settings] = await Promise.all([
    getCatalogItem(member, 'products', productId),
    getFactorySettings(member),
  ]);
  if (!settings.configured) throw new AppError('SETTINGS_REQUIRED', 409);
  if (product.kind !== 'finished' || !product.active) throw new AppError('INACTIVE_REFERENCE', 409);
  const recipe = (
    await getPool().query<RecipeVersion>(
      `SELECT r.id,r.product_id,r.revision,r.raw_product_id,r.product_snapshot,r.raw_snapshot,r.policy,r.note,r.status,r.created_at FROM recipe_versions r JOIN active_recipes a ON a.recipe_id=r.id WHERE a.product_id=$1`,
      [productId],
    )
  ).rows[0];
  if (!recipe) throw new AppError('NO_ACTIVE_RECIPE', 409);
  const values: unknown[] = [recipe.raw_product_id];
  let clause = '';
  if (cursor) {
    values.push(cursor.at, cursor.id);
    clause = 'AND (m.created_at,m.id)<($2::timestamptz,$3::uuid)';
  }
  const result = await getPool().query<SourceChoice>(
    `SELECT m.id,m.code::text,b.quantity_g::text,b.version,${date('m.created_at')} AS created_at FROM material_lots m JOIN material_accounts a ON a.raw_lot_id=m.id JOIN material_balances b ON b.account_id=a.id WHERE m.product_id=$1 AND b.quantity_g>0 ${clause} ORDER BY m.created_at DESC,m.id DESC LIMIT 26`,
    values,
  );
  const items = result.rows.slice(0, 25);
  const last = items.at(-1);
  return {
    product,
    recipe: {
      ...recipe,
      status: 'approved' as const,
      active: true,
      created_at: new Date(recipe.created_at).toISOString(),
    },
    settings_version: settings.version,
    timezone: settings.timezone!,
    sources: {
      items,
      next_cursor: result.rows.length > 25 && last ? { at: last.created_at, id: last.id } : null,
    },
  };
}
export async function listFermentations(member: Member, query: { q: string; cursor?: Cursor }) {
  requireAssetAccess(member);
  const values: unknown[] = [`%${query.q.replace(/[\\%_]/g, '\\$&')}%`];
  let clause = '';
  if (query.cursor) {
    values.push(query.cursor.at, query.cursor.id);
    clause = 'AND (f.created_at,f.id)<($2::timestamptz,$3::uuid)';
  }
  const result = await getPool().query<Fermentation>(
    `SELECT ${columns} ${joins} WHERE (p.name ILIKE $1 OR f.product_snapshot->>'name' ILIKE $1 OR f.code::text ILIKE $1) ${clause} ORDER BY f.created_at DESC,f.id DESC LIMIT 26`,
    values,
  );
  const items = result.rows.slice(0, 25);
  const last = items.at(-1);
  const time = (await getPool().query(`SELECT ${date('clock_timestamp()')} AS now`)).rows[0].now;
  return {
    items,
    next_cursor: result.rows.length > 25 && last ? { at: last.created_at, id: last.id } : null,
    server_time: time,
  };
}
export function getFermentation(member: Member, id: string, cursor?: Cursor) {
  requireAssetAccess(member);
  return detail(getPool(), id, cursor);
}
export function startFermentation(member: Member, key: string, input: FermentationInput) {
  const parsed = fermentationInputSchema.parse(input);
  return writeOnce(member, key, 'fermentation.start', parsed, async (client) => {
    const settings = (
      await client.query('SELECT * FROM factory_settings WHERE singleton=true FOR SHARE')
    ).rows[0];
    if (!settings.configured) throw new AppError('SETTINGS_REQUIRED', 409);
    if (settings.version !== parsed.settings_version) throw new AppError('VERSION_CONFLICT', 409);
    const recipe = (
      await client.query('SELECT * FROM recipe_versions WHERE id=$1 AND product_id=$2', [
        parsed.recipe_id,
        parsed.product_id,
      ])
    ).rows[0];
    if (!recipe) throw new AppError('NOT_FOUND', 404);
    const identities = await client.query(
      'SELECT DISTINCT type_id FROM products WHERE id=ANY($1::uuid[]) ORDER BY type_id',
      [[parsed.product_id, recipe.raw_product_id]],
    );
    const types = await client.query(
      'SELECT active FROM product_types WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
      [identities.rows.map((r) => r.type_id)],
    );
    const products = await client.query(
      'SELECT id,name,active,kind FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
      [[parsed.product_id, recipe.raw_product_id]],
    );
    if (types.rows.some((r) => !r.active) || products.rows.some((r) => !r.active))
      throw new AppError('INACTIVE_REFERENCE', 409);
    const active = (
      await client.query('SELECT recipe_id FROM active_recipes WHERE product_id=$1', [
        parsed.product_id,
      ])
    ).rows[0];
    if (active?.recipe_id !== parsed.recipe_id) throw new AppError('RECIPE_CHANGED', 409);
    const fermentationPolicy = { ...recipe.policy.fermentation };
    if (parsed.fermentation_duration_minutes !== undefined) {
      fermentationPolicy.duration_minutes = parsed.fermentation_duration_minutes;
      fermentationPolicy.warning_minutes = Math.min(
        fermentationPolicy.warning_minutes,
        parsed.fermentation_duration_minutes - 1,
      );
    }
    const source = (
      await client.query(
        'SELECT a.id FROM material_accounts a JOIN material_lots m ON m.id=a.raw_lot_id WHERE m.id=$1 AND m.product_id=$2',
        [parsed.raw_lot_id, recipe.raw_product_id],
      )
    ).rows[0];
    if (!source) throw new AppError('INVALID_SOURCE', 422);
    const [balance] = await lockBalances(client, [source.id]);
    if (balance.version !== parsed.source_version) throw new AppError('VERSION_CONFLICT', 409);
    if (toMilligrams(balance.quantity_g) < toMilligrams(parsed.quantity_g))
      throw new AppError('INSUFFICIENT_BALANCE', 409);
    const id = randomUUID(),
      account = randomUUID(),
      stage = randomUUID();
    const product = products.rows.find((p) => p.id === parsed.product_id);
    await client.query(
      'INSERT INTO fermentations(id,target_product_id,raw_product_id,raw_lot_id,recipe_id,product_snapshot,recipe_snapshot,settings_snapshot,quantity_g,created_by,fermentation_duration_minutes) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::numeric,$10,$11)',
      [
        id,
        parsed.product_id,
        recipe.raw_product_id,
        parsed.raw_lot_id,
        recipe.id,
        JSON.stringify(product),
        JSON.stringify(recipe),
        JSON.stringify(settings),
        parsed.quantity_g,
        member.id,
        parsed.fermentation_duration_minutes ?? null,
      ],
    );
    await client.query(
      "INSERT INTO stage_runs(id,fermentation_id,material_product_id,kind,policy,status,started_at,due_at) VALUES($1,$2,$3,'fermentation',$4::jsonb,'running',statement_timestamp(),statement_timestamp()+make_interval(mins=>$5))",
      [
        stage,
        id,
        recipe.raw_product_id,
        JSON.stringify(fermentationPolicy),
        fermentationPolicy.duration_minutes,
      ],
    );
    await client.query(
      'INSERT INTO material_accounts(id,product_id,fermentation_id) VALUES($1,$2,$3)',
      [account, recipe.raw_product_id, id],
    );
    await postMovement(client, {
      kind: 'fermentation_start',
      fermentation_id: id,
      actor_id: member.id,
      request_key: key,
      lines: [
        { account_id: source.id, quantity_g: `-${parsed.quantity_g}` },
        { account_id: account, quantity_g: parsed.quantity_g },
      ],
    });
    const after = await detail(client, id);
    await event(client, member, key, 'fermentation.started', id, {
      fermentation: after.fermentation,
      fermentation_policy: fermentationPolicy,
      recipe_duration_minutes: recipe.policy.fermentation.duration_minutes,
    });
    return after;
  });
}
export function readyFermentation(member: Member, key: string, id: string, input: unknown) {
  const parsed = fermentationReadySchema.parse(input);
  return writeOnce(member, key, `fermentation.ready:${id}`, parsed, async (client) => {
    const batch = (
      await client.query('SELECT status,version FROM fermentations WHERE id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (!batch) throw new AppError('NOT_FOUND', 404);
    if (batch.version !== parsed.expected_version) throw new AppError('VERSION_CONFLICT', 409);
    if (batch.status !== 'fermenting') throw new AppError('INVALID_STATE', 409);
    const stage = (
      await client.query(
        "SELECT id,due_at<=clock_timestamp() AS due FROM stage_runs WHERE fermentation_id=$1 AND status='running' FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!stage?.due) throw new AppError('INSPECTION_NOT_DUE', 409);
    await client.query(
      "UPDATE stage_runs SET status='completed',completed_at=clock_timestamp(),completed_by=$2 WHERE id=$1",
      [stage.id, member.id],
    );
    await client.query("UPDATE fermentations SET status='ready',version=version+1 WHERE id=$1", [
      id,
    ]);
    const after = await detail(client, id);
    await event(client, member, key, 'fermentation.ready', id, {
      fermentation: after.fermentation,
    });
    return after;
  });
}
export function withdrawFermentation(member: Member, key: string, id: string, input: unknown) {
  const parsed = withdrawalInputSchema.parse(input);
  return writeOnce(member, key, `fermentation.withdraw:${id}`, parsed, async (client) => {
    const batch = (await client.query('SELECT * FROM fermentations WHERE id=$1 FOR UPDATE', [id]))
      .rows[0];
    if (!batch) throw new AppError('NOT_FOUND', 404);
    if (batch.version !== parsed.expected_version) throw new AppError('VERSION_CONFLICT', 409);
    if (batch.status !== 'ready') throw new AppError('INVALID_STATE', 409);
    const source = (
      await client.query('SELECT id FROM material_accounts WHERE fermentation_id=$1', [id])
    ).rows[0];
    const [balance] = await lockBalances(client, [source.id]);
    if (toMilligrams(balance.quantity_g) < toMilligrams(parsed.quantity_g))
      throw new AppError('INSUFFICIENT_BALANCE', 409);
    const order = randomUUID(),
      stage = randomUUID(),
      account = randomUUID();
    await client.query(
      'INSERT INTO production_orders(id,fermentation_id,sequence_no,quantity_g,created_by) VALUES($1,$2,$3,$4::numeric,$5)',
      [order, id, batch.withdrawal_count + 1, parsed.quantity_g, member.id],
    );
    await client.query(
      "INSERT INTO stage_runs(id,production_order_id,material_product_id,kind,policy,status) VALUES($1,$2,$3,'oven',$4::jsonb,'queued')",
      [stage, order, batch.raw_product_id, JSON.stringify(batch.recipe_snapshot.policy.oven)],
    );
    await client.query(
      'INSERT INTO material_accounts(id,product_id,stage_run_id) VALUES($1,$2,$3)',
      [account, batch.raw_product_id, stage],
    );
    await postMovement(client, {
      kind: 'withdrawal',
      production_order_id: order,
      actor_id: member.id,
      request_key: key,
      lines: [
        { account_id: source.id, quantity_g: `-${parsed.quantity_g}` },
        { account_id: account, quantity_g: parsed.quantity_g },
      ],
    });
    await client.query(
      'UPDATE fermentations SET status=$2,version=version+1,withdrawal_count=withdrawal_count+1 WHERE id=$1',
      [
        id,
        toMilligrams(balance.quantity_g) === toMilligrams(parsed.quantity_g) ? 'depleted' : 'ready',
      ],
    );
    const after = await detail(client, id);
    await event(client, member, key, 'fermentation.withdrawn', order, {
      fermentation_id: id,
      order_id: order,
      quantity_g: parsed.quantity_g,
    });
    return { ...after, order_id: order };
  });
}
