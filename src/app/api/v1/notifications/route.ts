import { z } from 'zod';
import { requireMember } from '@/server/members';
import { listNotifications } from '@/server/notifications';
import { apiError, json } from '@/server/http';
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const before =
      p.has('before_at') || p.has('before_id')
        ? z
            .object({ at: z.iso.datetime({ offset: true }), id: z.string().min(1).max(100) })
            .parse({ at: p.get('before_at'), id: p.get('before_id') })
        : undefined;
    return json(await listNotifications(await requireMember(request.headers), before));
  } catch (error) {
    return apiError(error);
  }
}
