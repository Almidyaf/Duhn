import { z } from 'zod';
import { processingSchema } from '@/contracts/processing';
import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember } from '@/server/members';
import { processOrder } from '@/server/processing';
import { apiError, json, readWriteBody } from '@/server/http';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember(request.headers);
    return json(
      await processOrder(
        member,
        idempotencyKeySchema.parse(request.headers.get('idempotency-key')),
        z.uuid().parse((await context.params).id),
        processingSchema.parse(await readWriteBody(request)),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
