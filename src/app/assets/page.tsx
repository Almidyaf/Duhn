import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireMember } from '@/server/members';
import { listAssets } from '@/server/assets';
import { AppError } from '@/server/errors';
import { Shell } from '@/components/shell';
import { AssetsManager } from '@/features/assets/assets-manager';
import { ui } from '@/locales/ar/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: ui.assets };
export default async function AssetsPage() {
  const member = await requireMember(await headers()).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    if (error instanceof AppError && error.status === 403) redirect('/access');
    throw error;
  });
  if (member.role === 'operator') redirect('/access');
  const initial = await listAssets(member);
  return (
    <Shell member={member}>
      <AssetsManager initial={initial} userId={member.id} />
    </Shell>
  );
}
