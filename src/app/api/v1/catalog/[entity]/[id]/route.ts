import { z } from 'zod';
import {
  catalogDeleteSchema,
  catalogEntitySchema,
  catalogUpdateSchemas,
} from '@/contracts/catalog';
import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember } from '@/server/members';
import { deleteCatalogItem, getCatalogItem, updateCatalogItem } from '@/server/catalog';
import { apiError, json, readWriteBody } from '@/server/http';

type Context = { params: Promise<{ entity: string; id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const member = await requireMember(request.headers);
    const params = await context.params;
    const entity = catalogEntitySchema.parse(params.entity);
    const id = z.uuid().parse(params.id);
    return json({ item: await getCatalogItem(member, entity, id) });
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const member = await requireMember(request.headers);
    const params = await context.params;
    const entity = catalogEntitySchema.parse(params.entity);
    const id = z.uuid().parse(params.id);
    const input = catalogUpdateSchemas[entity].parse(await readWriteBody(request));
    const key = idempotencyKeySchema.parse(request.headers.get('idempotency-key'));
    return json({ item: await updateCatalogItem(member, key, entity, id, input) });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const member = await requireMember(request.headers);
    const params = await context.params;
    const entity = catalogEntitySchema.parse(params.entity);
    const id = z.uuid().parse(params.id);
    const input = catalogDeleteSchema.parse(await readWriteBody(request));
    const key = idempotencyKeySchema.parse(request.headers.get('idempotency-key'));
    return json(await deleteCatalogItem(member, key, entity, id, input));
  } catch (error) {
    return apiError(error);
  }
}
