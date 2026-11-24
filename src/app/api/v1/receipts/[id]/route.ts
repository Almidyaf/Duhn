import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { updateReceiptSchema } from '@/contracts/receipts';
import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember } from '@/server/members';
import { getReceipt, updateReceipt } from '@/server/receipts';
import { apiError, json, readWriteBody } from '@/server/http';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember(request.headers);
    return json(await getReceipt(member, z.uuid().parse((await context.params).id)));
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember(request.headers);
    const id = z.uuid().parse((await context.params).id);
    const rawKey = request.headers.get('idempotency-key') ?? request.headers.get('x-request-key');
    const key = rawKey ? idempotencyKeySchema.parse(rawKey) : randomUUID();
    const body = updateReceiptSchema.parse(await readWriteBody(request));
    return json(await updateReceipt(member, key, id, body));
  } catch (error) {
    return apiError(error);
  }
}
