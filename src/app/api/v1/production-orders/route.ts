import { z } from 'zod';
import { cursorSchema } from '@/contracts/catalog';
import { productionStartSchema } from '@/contracts/production';
import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember } from '@/server/members';
import { listProductionOrders, startProductionOrder } from '@/server/production';
import { apiError, json, readWriteBody } from '@/server/http';

export async function GET(request: Request) {
  try {
    const member = await requireMember(request.headers);
    const p = new URL(request.url).searchParams;
    const cursor =
      p.has('before_id') || p.has('before_at')
        ? cursorSchema.parse({ id: p.get('before_id'), at: p.get('before_at') })
        : undefined;
    return json(
      await listProductionOrders(member, {
        q: z.string().trim().max(120).parse(p.get('q') ?? ''),
        cursor,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireMember(request.headers);
    return json(
      await startProductionOrder(
        member,
        idempotencyKeySchema.parse(request.headers.get('idempotency-key')),
        productionStartSchema.parse(await readWriteBody(request)),
      ),
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
