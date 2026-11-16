import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireMember } from '@/server/members';
import { AppError } from '@/server/errors';
import { listProductionOrders } from '@/server/production';
import { Shell } from '@/components/shell';
import { ProductionManager } from '@/features/production/production-manager';
import { productionUi } from '@/locales/ar/production';

export const dynamic = 'force-dynamic';
export const metadata = { title: productionUi.title };

export default async function ProductionPage() {
  const member = await requireMember(await headers()).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    if (error instanceof AppError && error.status === 403) redirect('/access');
    throw error;
  });
  if (member.role === 'operator') redirect('/access');
  const initial = await listProductionOrders(member, { q: '' });
  return (
    <Shell member={member} section="production">
      <ProductionManager initial={initial} userId={member.id} />
    </Shell>
  );
}
