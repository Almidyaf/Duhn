import { randomUUID } from 'node:crypto';
import { ovenStartSchema, type OvenStartInput, type OvenChoice } from '../contracts/oven';
import type { Cursor } from '../contracts/catalog';
import { getPool } from './db';
import { requireAssetAccess, type Member } from './members';
import { writeOnce } from './write-once';
import { AppError } from './errors';

export async function availableOvens(member: Member, search: string, cursor?: Cursor) {
  requireAssetAccess(member);
  const values: unknown[] = [`%${search.replace(/[\\%_]/g, '\\$&')}%`];
  let clause = '';
  if (cursor) {
    values.push(cursor.at, cursor.id);
    clause = 'AND (a.created_at,a.id)<($2::timestamptz,$3::uuid)';
  }
  const result = await getPool().query<OvenChoice>(
    `SELECT a.id,a.name,a.version,to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
     FROM assets a WHERE a.active AND a.category='oven' AND a.name ILIKE $1
     AND NOT EXISTS(SELECT FROM stage_runs s WHERE s.asset_id=a.id AND s.status='running')
     ${clause} ORDER BY a.created_at DESC,a.id DESC LIMIT 26`,
    values,
  );
  const items = result.rows.slice(0, 25),
    last = items.at(-1);
  return {
    items,
    next_cursor: result.rows.length > 25 && last ? { at: last.created_at, id: last.id } : null,
  };
}

export function startOven(member: Member, key: string, orderId: string, input: OvenStartInput) {
  const parsed = ovenStartSchema.parse(input);
  return writeOnce(member, key, `oven.start:${orderId}`, parsed, async (client) => {
    // Equipment lock serializes competing starts and asset edits, then lock the stage.
    const asset = (
      await client.query(
        'SELECT id,name,category,active,version FROM assets WHERE id=$1 FOR UPDATE',
        [parsed.asset_id],
      )
    ).rows[0];
    if (!asset) throw new AppError('NOT_FOUND', 404);
    if (!asset.active || asset.category !== 'oven') throw new AppError('INVALID_OVEN', 409);
    if (asset.version !== parsed.asset_version) throw new AppError('VERSION_CONFLICT', 409);
    const stage = (
      await client.query(
        "SELECT * FROM stage_runs WHERE production_order_id=$1 AND kind='oven' FOR UPDATE",
        [orderId],
      )
    ).rows[0];
    if (!stage) throw new AppError('NOT_FOUND', 404);
    if (stage.version !== parsed.expected_version) throw new AppError('VERSION_CONFLICT', 409);
    if (stage.status !== 'queued') throw new AppError('OVEN_ALREADY_STARTED', 409);
    if (
      (
        await client.query("SELECT id FROM stage_runs WHERE asset_id=$1 AND status='running'", [
          asset.id,
        ])
      ).rowCount
    )
      throw new AppError('OVEN_BUSY', 409);
    const policy = {
      ...stage.policy,
      duration_minutes: parsed.duration_minutes,
      warning_minutes: Math.min(stage.policy.warning_minutes, parsed.duration_minutes - 1),
    };
    const saved = (
      await client.query(
        `UPDATE stage_runs SET status='running',asset_id=$2,asset_snapshot=$3::jsonb,started_by=$4,
      policy=$5::jsonb,oven_duration_minutes=$6,started_at=statement_timestamp(),due_at=statement_timestamp()+make_interval(mins=>$6),version=version+1
      WHERE id=$1 RETURNING id,production_order_id,status,version,started_at,due_at`,
        [
          stage.id,
          asset.id,
          JSON.stringify(asset),
          member.id,
          JSON.stringify(policy),
          parsed.duration_minutes,
        ],
      )
    ).rows[0];
    const result = {
      order_id: orderId,
      stage_id: saved.id,
      version: saved.version,
      status: saved.status,
      started_at: saved.started_at.toISOString(),
      due_at: saved.due_at.toISOString(),
    };
    const payload = { ...result, asset, policy };
    await client.query(
      'INSERT INTO audit_events(id,actor_id,action,entity_id,before_value,after_value,request_key) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
      [
        randomUUID(),
        member.id,
        'oven.started',
        orderId,
        JSON.stringify(stage),
        JSON.stringify(payload),
        key,
      ],
    );
    await client.query(
      'INSERT INTO outbox_events(id,topic,entity_id,payload) VALUES($1,$2,$3,$4::jsonb)',
      [randomUUID(), 'oven.started', orderId, JSON.stringify(payload)],
    );
    return result;
  });
}
