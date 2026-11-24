import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from './db';
import { writeOnce } from './write-once';
import { requireAssetAccess, type Member } from './members';
import { AppError } from './errors';
import { lockBalances, postMovement, type MaterialPosting } from './material-ledger';
import {
  receiptInputSchema,
  updateReceiptSchema,
  voidReceiptSchema,
  receiptQuerySchema,
  type ReceiptInput,
  type UpdateReceiptInput,
  type VoidReceiptInput,
  type Receipt,
  type ReceiptDetail,
  type ReceiptLine,
  type ReceiptQuery,
  type RawLot,
} from '../contracts/receipts';
import type { Cursor } from '../contracts/catalog';

const date = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const receiptColumns = `r.id,r.code::text,r.kind,r.supplier_id,r.supplier_name,r.reference,r.note,r.status,r.version,${date('r.created_at')} AS created_at,r.void_reason,${date('r.voided_at')} AS voided_at,(SELECT count(*)::int FROM receipt_lines WHERE receipt_id=r.id) AS line_count,(SELECT coalesce(sum(quantity_g),0)::numeric(20,3)::text FROM receipt_lines WHERE receipt_id=r.id) AS total_g`;
async function detail(client: Pick<PoolClient, 'query'>, id: string): Promise<ReceiptDetail> {
  // One statement snapshot includes both header and balances.
  const result = await client.query<{ receipt: Receipt; lines: ReceiptLine[] }>(
    `SELECT to_jsonb(h) AS receipt,coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.lot_code::bigint) FROM (SELECT l.id,l.product_id,l.product_name,l.type_name,l.quantity_g::numeric(18,3)::text,l.unit_price::text AS unit_price,m.id AS lot_id,m.code::text AS lot_code,a.id AS account_id,b.quantity_g::text AS balance_g,b.version AS balance_version FROM receipt_lines l JOIN material_lots m ON m.receipt_line_id=l.id JOIN material_accounts a ON a.raw_lot_id=m.id JOIN material_balances b ON b.account_id=a.id WHERE l.receipt_id=h.id) x),'[]'::jsonb) AS lines FROM (SELECT ${receiptColumns} FROM receipts r WHERE r.id=$1) h`,
    [id],
  );
  if (!result.rowCount) throw new AppError('NOT_FOUND', 404);
  return result.rows[0];
}
async function recordEvent(
  client: PoolClient,
  member: Member,
  key: string,
  topic: string,
  before: ReceiptDetail | null,
  after: ReceiptDetail,
  movementId: string,
) {
  await client.query(
    'INSERT INTO audit_events(id,actor_id,action,entity_id,before_value,after_value,request_key) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
    [
      randomUUID(),
      member.id,
      topic,
      after.receipt.id,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      key,
    ],
  );
  await client.query(
    'INSERT INTO outbox_events(id,topic,entity_id,payload) VALUES($1,$2,$3,$4::jsonb)',
    [
      randomUUID(),
      topic,
      after.receipt.id,
      JSON.stringify({
        receipt_id: after.receipt.id,
        movement_id: movementId,
        actor_id: member.id,
      }),
    ],
  );
}
export async function getReceipt(member: Member, id: string) {
  requireAssetAccess(member);
  return detail(getPool(), id);
}
export async function listReceipts(member: Member, query: ReceiptQuery) {
  requireAssetAccess(member);
  const input = receiptQuerySchema.parse(query);
  const values: unknown[] = [`%${input.q.replace(/[\\%_]/g, '\\$&')}%`];
  const clauses = [
    `(r.reference ILIKE $1 OR r.code::text ILIKE $1 OR r.supplier_name ILIKE $1 OR EXISTS(SELECT 1 FROM receipt_lines l WHERE l.receipt_id=r.id AND l.product_name ILIKE $1))`,
  ];
  if (input.status !== 'all') {
    values.push(input.status);
    clauses.push(`r.status=$${values.length}`);
  }
  if (input.cursor) {
    values.push(input.cursor.at, input.cursor.id);
    clauses.push(
      `(r.created_at,r.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`,
    );
  }
  const result = await getPool().query<Receipt>(
    `SELECT ${receiptColumns} FROM receipts r WHERE ${clauses.join(' AND ')} ORDER BY r.created_at DESC,r.id DESC LIMIT 26`,
    values,
  );
  const items = result.rows.slice(0, 25);
  const last = items.at(-1);
  return {
    items,
    next_cursor: result.rows.length > 25 && last ? { at: last.created_at, id: last.id } : null,
  };
}
export async function listRawLots(member: Member, query: { q: string; cursor?: Cursor }) {
  requireAssetAccess(member);
  const values: unknown[] = [`%${query.q.replace(/[\\%_]/g, '\\$&')}%`];
  let cursor = '';
  if (query.cursor) {
    values.push(query.cursor.at, query.cursor.id);
    cursor = 'AND (m.created_at,m.id)<($2::timestamptz,$3::uuid)';
  }
  const result = await getPool().query<RawLot>(
    `SELECT m.id,m.code::text,m.product_id,p.name AS product_name,coalesce(t.name,'') AS type_name,r.id AS receipt_id,r.code::text AS receipt_code,r.supplier_name,l.unit_price::text AS unit_price,b.quantity_g::text,b.version,${date('m.created_at')} AS created_at FROM material_lots m JOIN products p ON p.id=m.product_id LEFT JOIN product_types t ON t.id=p.type_id JOIN receipt_lines l ON l.id=m.receipt_line_id JOIN receipts r ON r.id=l.receipt_id JOIN material_accounts a ON a.raw_lot_id=m.id JOIN material_balances b ON b.account_id=a.id WHERE b.quantity_g>0 AND (p.name ILIKE $1 OR l.product_name ILIKE $1 OR m.code::text ILIKE $1 OR r.reference ILIKE $1) ${cursor} ORDER BY m.created_at DESC,m.id DESC LIMIT 26`,
    values,
  );
  const items = result.rows.slice(0, 25);
  const last = items.at(-1);
  return {
    items,
    next_cursor: result.rows.length > 25 && last ? { at: last.created_at, id: last.id } : null,
  };
}
export async function createReceipt(member: Member, key: string, input: ReceiptInput) {
  const parsed = receiptInputSchema.parse(input);
  // Pre-check also applies to replay: a former owner cannot replay an opening write.
  if (parsed.kind === 'opening' && member.role !== 'owner') throw new AppError('FORBIDDEN', 403);
  try {
    return await writeOnce(
      member,
      key,
      'receipt.create',
      parsed,
      async (client) => {
        let supplierName: string | null = parsed.supplier_name ?? null;
        if (parsed.supplier_id) {
          const supplier = await client.query(
            'SELECT name,active FROM suppliers WHERE id=$1 FOR SHARE',
            [parsed.supplier_id],
          );
          if (!supplier.rows[0]?.active) throw new AppError('INACTIVE_REFERENCE', 409);
          supplierName = supplier.rows[0].name;
        }
        const products = await client.query<{
          id: string;
          name: string;
          kind: string;
          active: boolean;
        }>(
          'SELECT id,name,kind,active FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
          [parsed.lines.map((l) => l.product_id)],
        );
        for (const line of parsed.lines) {
          const product = products.rows.find((p) => p.id === line.product_id);
          if (!product || product.kind !== 'raw')
            throw new AppError('INVALID_PRODUCT_KIND', 422);
          if (!product.active) throw new AppError('INACTIVE_REFERENCE', 409);
        }
        const receiptId = randomUUID();
        await client.query(
          'INSERT INTO receipts(id,kind,supplier_id,supplier_name,reference,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            receiptId,
            parsed.kind,
            parsed.supplier_id,
            supplierName,
            parsed.reference,
            parsed.note,
            member.id,
          ],
        );
        const postings: MaterialPosting[] = [];
        for (const line of [...parsed.lines].sort((a, b) =>
          a.product_id.localeCompare(b.product_id),
        )) {
          const product = products.rows.find((p) => p.id === line.product_id)!;
          const lineId = randomUUID(),
            lotId = randomUUID(),
            accountId = randomUUID();
          await client.query(
            'INSERT INTO receipt_lines(id,receipt_id,product_id,product_name,type_name,quantity_g,unit_price) VALUES($1,$2,$3,$4,$5,$6::numeric,$7::numeric)',
            [lineId, receiptId, product.id, product.name, '', line.quantity_g, line.unit_price ?? null],
          );
          await client.query(
            'INSERT INTO material_lots(id,receipt_line_id,product_id) VALUES($1,$2,$3)',
            [lotId, lineId, product.id],
          );
          await client.query(
            'INSERT INTO material_accounts(id,product_id,raw_lot_id) VALUES($1,$2,$3)',
            [accountId, product.id, lotId],
          );
          await client.query(
            "INSERT INTO material_accounts(id,product_id,external_kind) VALUES($1,$2,'receipt') ON CONFLICT DO NOTHING",
            [randomUUID(), product.id],
          );
          const external = await client.query(
            "SELECT id FROM material_accounts WHERE product_id=$1 AND external_kind='receipt'",
            [product.id],
          );
          postings.push(
            { account_id: accountId, quantity_g: line.quantity_g },
            { account_id: external.rows[0].id, quantity_g: `-${line.quantity_g}` },
          );
        }
        const movement = await postMovement(client, {
          kind: parsed.kind === 'opening' ? 'opening' : 'receipt',
          receipt_id: receiptId,
          actor_id: member.id,
          request_key: key,
          lines: postings,
        });
        const after = await detail(client, receiptId);
        await recordEvent(client, member, key, 'receipt.posted', null, after, movement);
        return after;
      },
      parsed.kind === 'opening' ? 'owner' : undefined,
    );
  } catch (error) {
    if (
      (error as { code?: string; constraint?: string }).code === '23505' &&
      (error as { constraint?: string }).constraint === 'receipts_reference_idx'
    )
      throw new AppError('DUPLICATE_REFERENCE', 409);
    throw error;
  }
}
export async function listSources(member: Member) {
  requireAssetAccess(member);
  const result = await getPool().query<{ supplier_name: string }>(
    "SELECT DISTINCT supplier_name FROM receipts WHERE supplier_name IS NOT NULL AND btrim(supplier_name)<>'' ORDER BY supplier_name ASC LIMIT 50",
  );
  return result.rows.map((r) => r.supplier_name);
}

export async function updateReceipt(
  member: Member,
  key: string,
  id: string,
  input: UpdateReceiptInput,
) {
  requireAssetAccess(member);
  const parsed = updateReceiptSchema.parse(input);
  return writeOnce(
    member,
    key,
    `receipt.update:${id}`,
    parsed,
    async (client) => {
      const header = await client.query(
        'SELECT status,version FROM receipts WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!header.rowCount) throw new AppError('NOT_FOUND', 404);
      if (header.rows[0].version !== parsed.expected_version)
        throw new AppError('VERSION_CONFLICT', 409);
      if (header.rows[0].status !== 'posted') throw new AppError('INVALID_STATE', 409);

      const before = await detail(client, id);

      const updates: string[] = ['version=version+1'];
      const values: unknown[] = [id];
      if (parsed.supplier_name !== undefined) {
        values.push(parsed.supplier_name);
        updates.push(`supplier_name=$${values.length}`);
      }
      if (parsed.reference !== undefined) {
        values.push(parsed.reference);
        updates.push(`reference=$${values.length}`);
      }
      if (parsed.note !== undefined) {
        values.push(parsed.note);
        updates.push(`note=$${values.length}`);
      }

      await client.query(
        `UPDATE receipts SET ${updates.join(',')} WHERE id=$1`,
        values,
      );

      if (parsed.lines?.length) {
        for (const line of parsed.lines) {
          await client.query(
            'UPDATE receipt_lines SET unit_price=$2::numeric WHERE id=$1 AND receipt_id=$3',
            [line.id, line.unit_price ?? null, id],
          );
        }
      }

      const after = await detail(client, id);
      await client.query(
        'INSERT INTO audit_events(id,actor_id,action,entity_id,before_value,after_value,request_key) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
        [
          randomUUID(),
          member.id,
          'receipt.updated',
          id,
          JSON.stringify(before),
          JSON.stringify(after),
          key,
        ],
      );
      return after;
    },
  );
}

export async function voidReceipt(
  member: Member,
  key: string,
  id: string,
  input: VoidReceiptInput,
) {
  const parsed = voidReceiptSchema.parse(input);
  requireAssetAccess(member);
  const identity = await getPool().query('SELECT kind FROM receipts WHERE id=$1', [id]);
  if (!identity.rowCount) throw new AppError('NOT_FOUND', 404);
  const ownerOnly = identity.rows[0].kind === 'opening';
  return writeOnce(
    member,
    key,
    `receipt.void:${id}`,
    parsed,
    async (client) => {
      const header = await client.query(
        'SELECT status,version,kind FROM receipts WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!header.rowCount) throw new AppError('NOT_FOUND', 404);
      if (header.rows[0].version !== parsed.expected_version)
        throw new AppError('VERSION_CONFLICT', 409);
      if (header.rows[0].status !== 'posted') throw new AppError('INVALID_STATE', 409);
      const original = await client.query<{ id: string }>(
        "SELECT id FROM material_movements WHERE receipt_id=$1 AND kind IN ('receipt','opening')",
        [id],
      );
      const originalLines = await client.query<MaterialPosting>(
        'SELECT account_id,(-quantity_g)::numeric(18,3)::text AS quantity_g FROM movement_lines WHERE movement_id=$1',
        [original.rows[0].id],
      );
      const balances = await lockBalances(
        client,
        originalLines.rows.map((l) => l.account_id),
      );
      // No undo after any downstream use, even when the material was later returned.
      if (balances.some((b) => !b.external_kind && b.version !== 1))
        throw new AppError('MATERIAL_ALREADY_USED', 409);
      const before = await detail(client, id);
      const movement = await postMovement(client, {
        kind: 'reversal',
        receipt_id: id,
        reverses_id: original.rows[0].id,
        reason: parsed.reason,
        actor_id: member.id,
        request_key: key,
        lines: originalLines.rows,
      });
      await client.query(
        "UPDATE receipts SET status='voided',version=version+1,void_reason=$2,voided_at=clock_timestamp(),voided_by=$3 WHERE id=$1",
        [id, parsed.reason, member.id],
      );
      const after = await detail(client, id);
      await recordEvent(client, member, key, 'receipt.voided', before, after, movement);
      return after;
    },
    ownerOnly ? 'owner' : undefined,
  );
}
