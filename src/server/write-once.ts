import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from './db';
import { AppError } from './errors';
import { requireAssetAccess, type Member } from './members';

async function verifyMember(client: PoolClient, member: Member, requiredRole?: 'owner') {
  const live = await client.query('SELECT role FROM app_members WHERE user_id=$1 AND active=true', [
    member.id,
  ]);
  if (
    !live.rowCount ||
    !['owner', 'manager'].includes(live.rows[0].role) ||
    (requiredRole && live.rows[0].role !== requiredRole)
  )
    throw new AppError('FORBIDDEN', 403);
}

export async function writeOnce<T>(
  member: Member,
  key: string,
  operation: string,
  payload: object,
  perform: (client: PoolClient) => Promise<T>,
  requiredRole?: 'owner',
): Promise<T> {
  requireAssetAccess(member);
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return transaction(async (client) => {
    await verifyMember(client, member, requiredRole);
    // The uniqueness conflict waits for a concurrent transaction using this key.
    const inserted = await client.query(
      `INSERT INTO idempotency_requests(actor_id,request_key,operation,payload_hash)
      VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING request_key`,
      [member.id, key, operation, hash],
    );
    if (!inserted.rowCount) {
      const previous = await client.query(
        'SELECT operation,payload_hash,response FROM idempotency_requests WHERE actor_id=$1 AND request_key=$2',
        [member.id, key],
      );
      if (!previous.rowCount) throw new AppError('RETRY_REQUEST', 503);
      if (previous.rows[0].operation !== operation || previous.rows[0].payload_hash !== hash)
        throw new AppError('IDEMPOTENCY_CONFLICT', 409);
      return previous.rows[0].response as T;
    }
    const response = await perform(client);
    await client.query(
      'UPDATE idempotency_requests SET response=$3::jsonb WHERE actor_id=$1 AND request_key=$2',
      [member.id, key, JSON.stringify(response)],
    );
    return response;
  });
}
