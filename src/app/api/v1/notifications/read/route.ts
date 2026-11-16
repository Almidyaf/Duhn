import { z } from 'zod';
import { requireMember } from '@/server/members';
import { readNotifications } from '@/server/notifications';
import { apiError, json, readWriteBody } from '@/server/http';
export async function POST(request: Request) {
  try {
    const member = await requireMember(request.headers);
    const input = z
      .union([
        z.object({ all: z.literal(true) }).strict(),
        z.object({ ids: z.array(z.string().min(1).max(100)).min(1).max(100) }).strict(),
      ])
      .parse(await readWriteBody(request));
    return json(await readNotifications(member, 'ids' in input ? input.ids : undefined));
  } catch (error) {
    return apiError(error);
  }
}
