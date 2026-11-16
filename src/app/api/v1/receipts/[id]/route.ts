import { z } from 'zod';
import { requireMember } from '@/server/members';
import { getReceipt } from '@/server/receipts';
import { apiError, json } from '@/server/http';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember(request.headers);
    return json(await getReceipt(member, z.uuid().parse((await context.params).id)));
  } catch (error) {
    return apiError(error);
  }
}
