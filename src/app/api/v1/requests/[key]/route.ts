import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember, requireAssetAccess } from '@/server/members';
import { getPool } from '@/server/db';
import { apiError, json } from '@/server/http';

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const member = await requireMember(request.headers);
    requireAssetAccess(member);
    const key = idempotencyKeySchema.parse((await context.params).key);
    const result = await getPool().query(
      'SELECT response FROM idempotency_requests WHERE actor_id=$1 AND request_key=$2',
      [member.id, key],
    );
    return json(
      result.rowCount && result.rows[0].response
        ? { status: 'completed', result: result.rows[0].response }
        : { status: 'unknown' },
    );
  } catch (error) {
    return apiError(error);
  }
}
