import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from './db';
import { writeOnce } from './write-once';
import { requireAssetAccess, type Member } from './members';
import { AppError } from './errors';
import { lockBalances, postMovement } from './material-ledger';
import {
  productionStartSchema,
  type ProductionStartInput,
  type ProductionOrderItem,
  type ProductionDetail,
  type SourceChoice,
} from '../contracts/production';
import { toMilligrams } from '../contracts/weight';
import type { Cursor } from '../contracts/catalog';
import { getCatalogItem } from './catalog';
import { getFactorySettings } from './settings';

const DEFAULT_OVEN_POLICY = {
  duration_minutes: 720,
  warning_minutes: 30,
  grace_minutes: 60,
  time_basis: 'active' as const,
  resume_policy: 'require_review' as const,
};

const date = (s: string) => `to_char(${s} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const orderSelect = `SELECT
  o.id,
  o.code::text,
  coalesce(o.target_product_id, f.target_product_id) AS target_product_id,
  tp.name AS product_name,
  coalesce(o.raw_product_id, f.raw_product_id) AS raw_product_id,
  rp.name AS raw_product_name,
  coalesce(o.raw_lot_id, f.raw_lot_id) AS raw_lot_id,
  o.quantity_g::numeric(18,3)::text,
  ${date('o.created_at')} AS created_at,
  coalesce(o.settings_snapshot->>'timezone', f.settings_snapshot->>'timezone', 'UTC') AS timezone,
  s.id AS stage_id,
  CASE WHEN EXISTS(SELECT FROM oven_pauses WHERE order_id=o.id AND ended_at IS NULL) THEN 'paused' ELSE s.status END AS stage_status,
  (SELECT ${date('started_at')} FROM oven_pauses WHERE order_id=o.id AND ended_at IS NULL) AS paused_at,
  s.version AS stage_version,
  ${date('s.started_at')} AS started_at,
  ${date('s.due_at')} AS due_at,
  (s.policy->>'duration_minutes')::int AS duration_minutes,
  (s.policy->>'warning_minutes')::int AS warning_minutes,
  (s.policy->>'grace_minutes')::int AS grace_minutes,
  s.policy->>'time_basis' AS time_basis,
  s.asset_snapshot->>'name' AS asset_name,
  op.state AS processing_state,
  op.version AS processing_version,
  pb.quantity_g::text AS available_g,
  (SELECT output_g::text FROM processing_results WHERE order_id=o.id AND kind='oven') AS oven_output_g,
  (SELECT output_g::text FROM processing_results WHERE order_id=o.id AND kind='filter') AS filter_output_g,
  (SELECT output_g::text FROM processing_results WHERE order_id=o.id AND kind='packing') AS packing_output_g
FROM production_orders o
LEFT JOIN fermentations f ON f.id=o.fermentation_id
JOIN products tp ON tp.id=coalesce(o.target_product_id, f.target_product_id)
JOIN products rp ON rp.id=coalesce(o.raw_product_id, f.raw_product_id)
JOIN stage_runs s ON s.production_order_id=o.id
LEFT JOIN order_processing op ON op.order_id=o.id
LEFT JOIN material_accounts pa ON pa.production_order_id=o.id
LEFT JOIN material_balances pb ON pb.account_id=pa.id`;

async function detail(client: Pick<PoolClient, 'query'>, id: string): Promise<ProductionDetail> {
  const result = await client.query<{ order: ProductionOrderItem; server_time: string }>(
    `SELECT to_jsonb(ox) AS order, ${date('clock_timestamp()')} AS server_time FROM (${orderSelect} WHERE o.id=$1) ox`,
    [id],
  );
  if (!result.rowCount) throw new AppError('NOT_FOUND', 404);
  return result.rows[0];
}

export async function productionOptions(member: Member, productId: string, cursor?: Cursor) {
  requireAssetAccess(member);
  const [product, settings] = await Promise.all([
    getCatalogItem(member, 'products', productId),
    getFactorySettings(member),
  ]);
  if (!settings.configured) throw new AppError('SETTINGS_REQUIRED', 409);
  if (product.kind !== 'finished' || !product.active) throw new AppError('INACTIVE_REFERENCE', 409);
  if (!product.raw_product_id) throw new AppError('RAW_LINK_REQUIRED', 422);
  const rawProduct = await getCatalogItem(member, 'products', product.raw_product_id);
  if (rawProduct.kind !== 'raw' || !rawProduct.active) throw new AppError('INACTIVE_REFERENCE', 409);

  const values: unknown[] = [rawProduct.id];
  let clause = '';
  if (cursor) {
    values.push(cursor.at, cursor.id);
    clause = 'AND (m.created_at,m.id)<($2::timestamptz,$3::uuid)';
  }
  const result = await getPool().query<SourceChoice>(
    `SELECT m.id,m.code::text,b.quantity_g::text,b.version,${date('m.created_at')} AS created_at
     FROM material_lots m
     JOIN material_accounts a ON a.raw_lot_id=m.id
     JOIN material_balances b ON b.account_id=a.id
     WHERE m.product_id=$1 AND b.quantity_g>0 ${clause}
     ORDER BY m.created_at DESC,m.id DESC LIMIT 26`,
    values,
  );
  const items = result.rows.slice(0, 25);
  const last = items.at(-1);
  return {
    product,
    raw_product: rawProduct,
    settings_version: settings.version,
    timezone: settings.timezone!,
    sources: {
      items,
      next_cursor: result.rows.length > 25 && last ? { at: last.created_at, id: last.id } : null,
    },
  };
}

export async function listProductionOrders(member: Member, query: { q: string; cursor?: Cursor }) {
  requireAssetAccess(member);
  const values: unknown[] = [`%${query.q.replace(/[\\%_]/g, '\\$&')}%`];
  let clause = '';
  if (query.cursor) {
    values.push(query.cursor.at, query.cursor.id);
    clause = 'AND (o.created_at,o.id)<($2::timestamptz,$3::uuid)';
  }
  const result = await getPool().query<ProductionOrderItem>(
    `${orderSelect}
     WHERE (tp.name ILIKE $1 OR rp.name ILIKE $1 OR o.code::text ILIKE $1) ${clause}
     ORDER BY o.created_at DESC,o.id DESC LIMIT 26`,
    values,
  );
  const items = result.rows.slice(0, 25);
  const last = items.at(-1);
  return {
    items,
    next_cursor: result.rows.length > 25 && last ? { at: last.created_at, id: last.id } : null,
    server_time: new Date().toISOString(),
  };
}

export function getProductionOrder(member: Member, id: string) {
  requireAssetAccess(member);
  return detail(getPool(), id);
}

export function startProductionOrder(member: Member, key: string, input: ProductionStartInput) {
  const parsed = productionStartSchema.parse(input);
  return writeOnce(member, key, 'production.start', parsed, async (client) => {
    const settings = (
      await client.query('SELECT * FROM factory_settings WHERE singleton=true FOR SHARE')
    ).rows[0];
    if (!settings.configured) throw new AppError('SETTINGS_REQUIRED', 409);
    if (settings.version !== parsed.settings_version) throw new AppError('VERSION_CONFLICT', 409);

    const targetRow = (
      await client.query(
        'SELECT id,name,kind,active,raw_product_id FROM products WHERE id=$1 FOR SHARE',
        [parsed.product_id],
      )
    ).rows[0];
    if (!targetRow) throw new AppError('NOT_FOUND', 404);
    if (targetRow.kind !== 'finished' || !targetRow.raw_product_id)
      throw new AppError('INVALID_PRODUCT_KIND', 422);
    if (!targetRow.active) throw new AppError('INACTIVE_REFERENCE', 409);

    const rawRow = (
      await client.query('SELECT id,name,kind,active FROM products WHERE id=$1 FOR SHARE', [
        targetRow.raw_product_id,
      ])
    ).rows[0];
    if (!rawRow || rawRow.kind !== 'raw') throw new AppError('INVALID_PRODUCT_KIND', 422);
    if (!rawRow.active) throw new AppError('INACTIVE_REFERENCE', 409);

    const source = (
      await client.query(
        'SELECT a.id FROM material_accounts a JOIN material_lots m ON m.id=a.raw_lot_id WHERE m.id=$1 AND m.product_id=$2',
        [parsed.raw_lot_id, rawRow.id],
      )
    ).rows[0];
    if (!source) throw new AppError('INVALID_SOURCE', 422);

    const [balance] = await lockBalances(client, [source.id]);
    if (balance.version !== parsed.source_version) throw new AppError('VERSION_CONFLICT', 409);
    if (toMilligrams(balance.quantity_g) < toMilligrams(parsed.quantity_g))
      throw new AppError('INSUFFICIENT_BALANCE', 409);

    const orderId = randomUUID();
    const stageId = randomUUID();
    const accountId = randomUUID();

    await client.query(
      `INSERT INTO production_orders(id,target_product_id,raw_product_id,raw_lot_id,product_snapshot,settings_snapshot,quantity_g,created_by)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::numeric,$8)`,
      [
        orderId,
        targetRow.id,
        rawRow.id,
        parsed.raw_lot_id,
        JSON.stringify({ target: targetRow, raw: rawRow }),
        JSON.stringify(settings),
        parsed.quantity_g,
        member.id,
      ],
    );

    await client.query(
      `INSERT INTO stage_runs(id,production_order_id,material_product_id,kind,policy,status)
       VALUES($1,$2,$3,'oven',$4::jsonb,'queued')`,
      [stageId, orderId, rawRow.id, JSON.stringify(DEFAULT_OVEN_POLICY)],
    );

    await client.query(
      'INSERT INTO material_accounts(id,product_id,stage_run_id) VALUES($1,$2,$3)',
      [accountId, rawRow.id, stageId],
    );

    await postMovement(client, {
      kind: 'production_start',
      production_order_id: orderId,
      actor_id: member.id,
      request_key: key,
      lines: [
        { account_id: source.id, quantity_g: `-${parsed.quantity_g}` },
        { account_id: accountId, quantity_g: parsed.quantity_g },
      ],
    });

    const after = await detail(client, orderId);
    await client.query(
      'INSERT INTO audit_events(id,actor_id,action,entity_id,after_value,request_key) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
      [randomUUID(), member.id, 'production.started', orderId, JSON.stringify(after.order), key],
    );
    await client.query(
      'INSERT INTO outbox_events(id,topic,entity_id,payload) VALUES($1,$2,$3,$4::jsonb)',
      [
        randomUUID(),
        'production.started',
        orderId,
        JSON.stringify({ order_id: orderId, quantity_g: parsed.quantity_g }),
      ],
    );
    return after;
  });
}
