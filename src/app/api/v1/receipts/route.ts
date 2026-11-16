import { receiptInputSchema, receiptQuerySchema } from '@/contracts/receipts';
import { cursorSchema } from '@/contracts/catalog';
import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember } from '@/server/members';
import { createReceipt, listReceipts } from '@/server/receipts';
import { apiError, json, readWriteBody } from '@/server/http';
export async function GET(request: Request) {
  try {
    const member = await requireMember(request.headers);
    const p = new URL(request.url).searchParams;
    const cursor =
      p.has('before_id') || p.has('before_at')
        ? cursorSchema.parse({ id: p.get('before_id'), at: p.get('before_at') })
        : undefined;
    return json(
      await listReceipts(
        member,
        receiptQuerySchema.parse({ q: p.get('q') ?? '', status: p.get('status') ?? 'all', cursor }),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const member = await requireMember(request.headers);
    const input = receiptInputSchema.parse(await readWriteBody(request));
    return json(
      await createReceipt(
        member,
        idempotencyKeySchema.parse(request.headers.get('idempotency-key')),
        input,
      ),
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
