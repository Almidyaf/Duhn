import { z } from 'zod';
import { assetDeleteSchema, assetUpdateSchema } from '@/contracts/assets';
import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember } from '@/server/members';
import { deleteAsset, updateAsset } from '@/server/assets';
import { apiError, json, readWriteBody } from '@/server/http';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember(request.headers);
    const id = z.uuid().parse((await context.params).id);
    const input = assetUpdateSchema.parse(await readWriteBody(request));
    const key = idempotencyKeySchema.parse(request.headers.get('idempotency-key'));
    return json({ asset: await updateAsset(member, key, id, input) });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember(request.headers);
    const id = z.uuid().parse((await context.params).id);
    const input = assetDeleteSchema.parse(await readWriteBody(request));
    const key = idempotencyKeySchema.parse(request.headers.get('idempotency-key'));
    return json(await deleteAsset(member, key, id, input));
  } catch (error) {
    return apiError(error);
  }
}
