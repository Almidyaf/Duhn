import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { requireMember } from '@/server/members';
import { AppError } from '@/server/errors';
import { getProductionOrder } from '@/server/production';
import { Shell } from '@/components/shell';
import { ProductionOrderDetailView } from '@/features/production/order-detail';
import { productionUi } from '@/locales/ar/production';

export const dynamic = 'force-dynamic';
export const metadata = { title: productionUi.details };

export default async function ProductionOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const member = await requireMember(await headers()).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    if (error instanceof AppError && error.status === 403) redirect('/access');
    throw error;
  });
  if (member.role === 'operator') redirect('/access');
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const initial = await getProductionOrder(member, id.data).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return (
    <Shell member={member} section="production">
      <ProductionOrderDetailView initial={initial} userId={member.id} />
    </Shell>
  );
}
