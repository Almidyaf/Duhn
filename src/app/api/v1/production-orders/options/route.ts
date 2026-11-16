import { z } from 'zod';
import { cursorSchema } from '@/contracts/catalog';
import { requireMember } from '@/server/members';
import { productionOptions } from '@/server/production';
import { apiError, json } from '@/server/http';

export async function GET(request: Request) {
  try {
    const member = await requireMember(request.headers);
    const p = new URL(request.url).searchParams;
    const cursor =
      p.has('before_id') || p.has('before_at')
        ? cursorSchema.parse({ id: p.get('before_id'), at: p.get('before_at') })
        : undefined;
    return json(await productionOptions(member, z.uuid().parse(p.get('product_id')), cursor));
  } catch (error) {
    return apiError(error);
  }
}
