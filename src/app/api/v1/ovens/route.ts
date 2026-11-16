import { z } from 'zod';
import { cursorSchema } from '@/contracts/catalog';
import { requireMember } from '@/server/members';
import { availableOvens } from '@/server/oven';
import { apiError, json } from '@/server/http';
export async function GET(request: Request) {
  try {
    const member = await requireMember(request.headers);
    const params = new URL(request.url).searchParams;
    const q = z
      .string()
      .trim()
      .max(120)
      .parse(params.get('q') ?? '');
    const cursor =
      params.has('before_at') || params.has('before_id')
        ? cursorSchema.parse({ at: params.get('before_at'), id: params.get('before_id') })
        : undefined;
    return json(await availableOvens(member, q, cursor));
  } catch (error) {
    return apiError(error);
  }
}
