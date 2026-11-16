import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getPool } from './db';
import { AppError } from './errors';
import { toMilligrams, fromMilligrams, weightSchema } from '../contracts/weight';

export type MaterialPosting = { account_id: string; quantity_g: string };
const signedWeight = z
  .string()
  .regex(/^-?(0|[1-9]\d{0,14})\.\d{3}$/)
  .refine((v) => v !== '0.000' && v !== '-0.000');
function milligrams(value: string) {
  return value.startsWith('-') ? -toMilligrams(value.slice(1)) : toMilligrams(value);
}
export async function lockBalances(client: PoolClient, ids: string[]) {
  const result = await client.query<{
    account_id: string;
    quantity_g: string;
    version: number;
    product_id: string;
    external_kind: string | null;
  }>(
    `SELECT account_id,quantity_g::numeric(18,3)::text,version,product_id,external_kind FROM lock_material_balances($1::uuid[])`,
    [ids],
  );
  if (result.rowCount !== new Set(ids).size) throw new AppError('NOT_FOUND', 404);
  return result.rows;
}
// Internal primitive, deliberately no HTTP endpoint. The domain command owns authorization,
// idempotency and the transaction. Production conversion requires a later explicit contract.
export async function postMovement(
  client: PoolClient,
  input: {
    kind:
      | 'receipt'
      | 'opening'
      | 'reversal'
      | 'transfer'
      | 'fermentation_start'
      | 'withdrawal'
      | 'production_start'
      | 'processing'
      | 'sale';
    fermentation_id?: string;
    production_order_id?: string;
    receipt_id?: string;
    reverses_id?: string;
    reason?: string;
    actor_id: string;
    request_key: string;
    lines: MaterialPosting[];
  },
) {
  if (
    input.lines.length < 2 ||
    input.lines.length > 50 ||
    new Set(input.lines.map((l) => l.account_id)).size !== input.lines.length
  )
    throw new AppError('INVALID_INPUT', 400);
  for (const l of input.lines) {
    z.uuid().parse(l.account_id);
    signedWeight.parse(l.quantity_g);
  }
  const balances = await lockBalances(
    client,
    input.lines.map((l) => l.account_id),
  );
  const sums = new Map<string, bigint>();
  for (const line of input.lines) {
    const account = balances.find((a) => a.account_id === line.account_id)!;
    const delta = milligrams(line.quantity_g);
    const after = milligrams(account.quantity_g) + delta;
    if (!account.external_kind && after < 0n) throw new AppError('INSUFFICIENT_BALANCE', 409);
    weightSchema.parse(fromMilligrams(after < 0n ? -after : after));
    sums.set(account.product_id, (sums.get(account.product_id) ?? 0n) + delta);
  }
  if ([...sums.values()].some((v) => v !== 0n)) throw new AppError('UNBALANCED_MOVEMENT', 422);
  const id = randomUUID();
  await client.query(
    'INSERT INTO material_movements(id,kind,receipt_id,reverses_id,reason,actor_id,request_key,fermentation_id,production_order_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      id,
      input.kind,
      input.receipt_id ?? null,
      input.reverses_id ?? null,
      input.reason ?? '',
      input.actor_id,
      input.request_key,
      input.fermentation_id ?? null,
      input.production_order_id ?? null,
    ],
  );
  for (const line of [...input.lines].sort((a, b) => a.account_id.localeCompare(b.account_id)))
    await client.query(
      'INSERT INTO movement_lines(movement_id,account_id,quantity_g) VALUES($1,$2,$3::numeric)',
      [id, line.account_id, line.quantity_g],
    );
  return id;
}
export async function reconcileMaterials() {
  // Single statement snapshot: concurrent commits cannot cause a false mismatch.
  const result = await getPool().query<{ account_id: string; stored_g: string; ledger_g: string }>(
    `SELECT b.account_id,b.quantity_g::text AS stored_g,coalesce(sum(l.quantity_g),0)::text AS ledger_g FROM material_balances b LEFT JOIN movement_lines l ON l.account_id=b.account_id GROUP BY b.account_id,b.quantity_g HAVING b.quantity_g<>coalesce(sum(l.quantity_g),0) LIMIT 100`,
  );
  return result.rows;
}
