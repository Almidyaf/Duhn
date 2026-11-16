import { z } from 'zod';
import { voidReceiptSchema } from '@/contracts/receipts';
import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember } from '@/server/members';
import { voidReceipt } from '@/server/receipts';
import { apiError, json, readWriteBody } from '@/server/http';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember(request.headers);
    const input = voidReceiptSchema.parse(await readWriteBody(request));
    return json(
      await voidReceipt(
        member,
        idempotencyKeySchema.parse(request.headers.get('idempotency-key')),
        z.uuid().parse((await context.params).id),
        input,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
