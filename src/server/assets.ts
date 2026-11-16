import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from './db';
import { AppError } from './errors';
import { requireAssetAccess, type Member } from './members';
import {
  assetDeleteSchema,
  type Asset,
  type AssetDelete,
  type AssetInput,
  type AssetUpdate,
} from '../contracts/assets';

import { writeOnce } from './write-once';

const columns = `id,code::text,name,category,location,notes,active,version,
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;

async function audit(
  client: PoolClient,
  member: Member,
  key: string,
  asset: Asset | null,
  before: Asset | null,
  action?: string,
) {
  const targetId = asset?.id ?? before?.id;
  await client.query(
    'INSERT INTO audit_events(id,actor_id,action,entity_id,before_value,after_value,request_key) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
    [
      randomUUID(),
      member.id,
      action ?? (before ? 'asset.updated' : 'asset.created'),
      targetId,
      before ? JSON.stringify(before) : null,
      asset ? JSON.stringify(asset) : null,
      key,
    ],
  );
}

export async function listAssets(
  member: Member,
  before?: { at: string; id: string },
  search = '',
  status: 'all' | 'active' | 'inactive' = 'all',
) {
  requireAssetAccess(member);
  const values: unknown[] = [`%${search.replace(/[\\%_]/g, '\\$&')}%`];
  const clauses = ['name ILIKE $1'];
  if (status !== 'all') {
    values.push(status === 'active');
    clauses.push(`active=$${values.length}`);
  }
  if (before) {
    values.push(before.at, before.id);
    clauses.push(`(created_at,id) < ($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
  }
  const result = await getPool().query<Asset>(
    `SELECT ${columns} FROM assets WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC,id DESC LIMIT 26`,
    values,
  );
  const items = result.rows.slice(0, 25);
  const last = items.at(-1);
  return {
    items,
    next_cursor: result.rows.length > 25 && last ? { at: last.created_at, id: last.id } : null,
  };
}

export function createAsset(member: Member, key: string, input: AssetInput) {
  return writeOnce(member, key, 'asset.create', input, async (client) => {
    const result = await client.query<Asset>(
      `INSERT INTO assets(id,name,category,location,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING ${columns}`,
      [randomUUID(), input.name, input.category, input.location, input.notes, member.id],
    );
    const asset = result.rows[0];
    await audit(client, member, key, asset, null);
    return asset;
  });
}

function isMotorAsset(name: string) {
  return /(ماطور|موتور|motor)/i.test(name);
}

export function updateAsset(member: Member, key: string, id: string, input: AssetUpdate) {
  return writeOnce(member, key, `asset.update:${id}`, input, async (client) => {
    const old = await client.query<Asset>(`SELECT ${columns} FROM assets WHERE id=$1 FOR UPDATE`, [
      id,
    ]);
    if (!old.rowCount) throw new AppError('NOT_FOUND', 404);
    if (old.rows[0].version !== input.expected_version) throw new AppError('VERSION_CONFLICT', 409);
    const result = await client.query<Asset>(
      `UPDATE assets SET name=$2,category=$3,location=$4,notes=$5,active=$6,
      version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
      [id, input.name, input.category, input.location, input.notes, input.active],
    );
    await audit(client, member, key, result.rows[0], old.rows[0]);

    // When a motor is deactivated (breaks down), pause all running, unpaused ovens atomically.
    if (
      old.rows[0].active &&
      !input.active &&
      (isMotorAsset(input.name) || isMotorAsset(old.rows[0].name))
    ) {
      const reason = `تعطل الماطور (${result.rows[0].name})`;
      const running = await client.query<{ id: string; order_id: string }>(
        `SELECT s.id, s.production_order_id AS order_id
         FROM stage_runs s
         WHERE s.stage = 'oven'
           AND s.status = 'running'
           AND NOT EXISTS (SELECT 1 FROM order_processing op WHERE op.order_id = s.production_order_id)
           AND NOT EXISTS (SELECT 1 FROM oven_pauses p WHERE p.order_id = s.production_order_id AND p.ended_at IS NULL)
         ORDER BY s.production_order_id ASC
         FOR UPDATE OF s`,
      );
      for (const stage of running.rows) {
        const pauseId = randomUUID();
        await client.query(
          'INSERT INTO oven_pauses(id,order_id,reason,actor_id) VALUES($1,$2,$3,$4)',
          [pauseId, stage.order_id, reason, member.id],
        );
        await client.query('UPDATE stage_runs SET version=version+1 WHERE id=$1', [stage.id]);
        await client.query(
          'INSERT INTO audit_events(id,actor_id,action,entity_id,after_value,request_key) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
          [randomUUID(), member.id, 'oven.paused', stage.order_id, JSON.stringify({ reason, asset_id: id }), key],
        );
        await client.query(
          'INSERT INTO outbox_events(id,topic,entity_id,payload) VALUES($1,$2,$3,$4::jsonb)',
          [randomUUID(), 'oven.paused', pauseId, JSON.stringify({ reason, asset_id: id, order_id: stage.order_id })],
        );
      }
    }

    return result.rows[0];
  });
}

export function deleteAsset(member: Member, key: string, id: string, input: AssetDelete) {
  const parsed = assetDeleteSchema.parse(input);
  return writeOnce(member, key, `asset.delete:${id}`, parsed, async (client) => {
    const old = await client.query<Asset>(`SELECT ${columns} FROM assets WHERE id=$1 FOR UPDATE`, [
      id,
    ]);
    if (!old.rowCount) throw new AppError('NOT_FOUND', 404);
    if (old.rows[0].version !== parsed.expected_version) throw new AppError('VERSION_CONFLICT', 409);
    const ref = await client.query<{ used: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM stage_runs WHERE asset_id=$1) AS used',
      [id],
    );
    if (ref.rows[0]?.used) throw new AppError('ITEM_IN_USE', 409);
    await audit(client, member, key, null, old.rows[0], 'asset.deleted');
    try {
      await client.query('DELETE FROM assets WHERE id=$1', [id]);
    } catch (error) {
      if ((error as { code?: string })?.code === '23503')
        throw new AppError('ITEM_IN_USE', 409);
      throw error;
    }
    return { deleted: true as const, id };
  });
}
