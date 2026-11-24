import { requireMember } from '@/server/members';
import { listSources } from '@/server/receipts';
import { apiError, json } from '@/server/http';

export async function GET(request: Request) {
  try {
    const member = await requireMember(request.headers);
    return json(await listSources(member));
  } catch (error) {
    return apiError(error);
  }
}
