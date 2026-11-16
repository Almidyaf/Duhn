import { getAuth } from './auth';
import { getPool } from './db';
import { AppError } from './errors';

export type Member = { id: string; name: string; role: 'owner' | 'manager' | 'operator' };
export async function requireMember(headers: Headers): Promise<Member> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) throw new AppError('UNAUTHENTICATED', 401);
  const result = await getPool().query<{ role: Member['role'] }>(
    'SELECT role FROM app_members WHERE user_id=$1 AND active=true',
    [session.user.id],
  );
  if (!result.rowCount) throw new AppError('FORBIDDEN', 403);
  return { id: session.user.id, name: session.user.name, role: result.rows[0].role };
}

export function requireAssetAccess(member: Member) {
  if (member.role !== 'owner' && member.role !== 'manager') throw new AppError('FORBIDDEN', 403);
}
