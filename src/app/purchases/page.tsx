import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireMember } from '@/server/members';
import { AppError } from '@/server/errors';
import { listReceipts } from '@/server/receipts';
import { Shell } from '@/components/shell';
import { ReceiptManager } from '@/features/receipts/receipt-manager';
import { receiptUi } from '@/locales/ar/receipts';
export const dynamic = 'force-dynamic';
export const metadata = { title: receiptUi.title };
export default async function PurchasesPage() {
  const member = await requireMember(await headers()).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    if (error instanceof AppError && error.status === 403) redirect('/access');
    throw error;
  });
  if (member.role === 'operator') redirect('/access');
  const initial = await listReceipts(member, { q: '', status: 'all' });
  return (
    <Shell member={member} section="purchases">
      <ReceiptManager initial={initial} userId={member.id} isOwner={member.role === 'owner'} />
    </Shell>
  );
}
