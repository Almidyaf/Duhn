import {
  catalogEntitySchema,
  catalogInputSchemas,
  catalogQuerySchema,
  cursorSchema,
} from '@/contracts/catalog';
import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember } from '@/server/members';
import { createCatalogItem, listCatalog } from '@/server/catalog';
import { apiError, json, readWriteBody } from '@/server/http';

type Context = { params: Promise<{ entity: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const member = await requireMember(request.headers);
    const entity = catalogEntitySchema.parse((await context.params).entity);
    const params = new URL(request.url).searchParams;
    const cursor =
      params.has('before_id') || params.has('before_at')
        ? cursorSchema.parse({ id: params.get('before_id'), at: params.get('before_at') })
        : undefined;
    const input = catalogQuerySchema.parse({
      q: params.get('q') ?? '',
      status: params.get('status') ?? 'all',
      type_id: params.get('type_id') ?? undefined,
      kind: params.get('kind') ?? undefined,
      cursor,
    });
    return json(await listCatalog(member, entity, input));
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const member = await requireMember(request.headers);
    const entity = catalogEntitySchema.parse((await context.params).entity);
    const input = catalogInputSchemas[entity].parse(await readWriteBody(request));
    const key = idempotencyKeySchema.parse(request.headers.get('idempotency-key'));
    return json({ item: await createCatalogItem(member, key, entity, input) }, 201);
  } catch (error) {
    return apiError(error);
  }
}
