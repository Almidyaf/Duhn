import { z } from 'zod';
import { assetInputSchema } from '@/contracts/assets';
import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember } from '@/server/members';
import { createAsset, listAssets } from '@/server/assets';
import { apiError, json, readWriteBody } from '@/server/http';

export async function GET(request: Request) {
  try {
    const member = await requireMember(request.headers);
    const params = new URL(request.url).searchParams;
    const cursor =
      params.has('before_id') || params.has('before_at')
        ? z
            .object({ id: z.uuid(), at: z.iso.datetime({ offset: true }) })
            .parse({ id: params.get('before_id'), at: params.get('before_at') })
        : undefined;
    const search = z
      .string()
      .max(120)
      .parse(params.get('q') ?? '');
    const status = z.enum(['all', 'active', 'inactive']).parse(params.get('status') ?? 'all');
    const result = await listAssets(member, cursor, search, status);
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const member = await requireMember(request.headers);
    const input = assetInputSchema.parse(await readWriteBody(request));
    const key = idempotencyKeySchema.parse(request.headers.get('idempotency-key'));
    return json({ asset: await createAsset(member, key, input) }, 201);
  } catch (error) {
    return apiError(error);
  }
}
