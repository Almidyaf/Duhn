import { factorySettingsInputSchema } from '@/contracts/settings';
import { idempotencyKeySchema } from '@/contracts/requests';
import { requireMember } from '@/server/members';
import { getFactorySettings, updateFactorySettings } from '@/server/settings';
import { apiError, json, readWriteBody } from '@/server/http';
export async function GET(request: Request) {
  try {
    return json(await getFactorySettings(await requireMember(request.headers)));
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const member = await requireMember(request.headers);
    const input = factorySettingsInputSchema.parse(await readWriteBody(request));
    return json(
      await updateFactorySettings(
        member,
        idempotencyKeySchema.parse(request.headers.get('idempotency-key')),
        input,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
