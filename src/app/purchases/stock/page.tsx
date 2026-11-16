import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireMember } from '@/server/members';
import { AppError } from '@/server/errors';
import { listRawLots } from '@/server/receipts';
import { Shell } from '@/components/shell';
import { RawStock } from '@/features/receipts/raw-stock';
import { receiptUi } from '@/locales/ar/receipts';
export const dynamic = 'force-dynamic';
export const metadata = { title: receiptUi.stock };
export default async function StockPage() {
  const member = await requireMember(await headers()).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    if (error instanceof AppError && error.status === 403) redirect('/access');
    throw error;
  });
  if (member.role === 'operator') redirect('/access');
  return (
    <Shell member={member} section="purchases">
      <RawStock initial={await listRawLots(member, { q: '' })} />
    </Shell>
  );
}
