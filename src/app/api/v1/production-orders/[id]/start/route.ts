import { z } from 'zod';
import { ovenStartSchema } from '@/contracts/oven';
import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember } from '@/server/members';
import { startOven } from '@/server/oven';
import { apiError, json, readWriteBody } from '@/server/http';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember(request.headers);
    return json(
      await startOven(
        member,
        idempotencyKeySchema.parse(request.headers.get('idempotency-key')),
        z.uuid().parse((await context.params).id),
        ovenStartSchema.parse(await readWriteBody(request)),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
