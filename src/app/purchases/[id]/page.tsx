import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { requireMember } from '@/server/members';
import { AppError } from '@/server/errors';
import { getReceipt } from '@/server/receipts';
import { Shell } from '@/components/shell';
import { ReceiptDetailView } from '@/features/receipts/receipt-detail';
import { receiptUi } from '@/locales/ar/receipts';
export const dynamic = 'force-dynamic';
export const metadata = { title: receiptUi.details };
export default async function DetailPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember(await headers()).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    if (error instanceof AppError && error.status === 403) redirect('/access');
    throw error;
  });
  if (member.role === 'operator') redirect('/access');
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) notFound();
  const initial = await getReceipt(member, parsed.data).catch((error) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  return (
    <Shell member={member} section="purchases">
      <ReceiptDetailView initial={initial} userId={member.id} isOwner={member.role === 'owner'} />
    </Shell>
  );
}
