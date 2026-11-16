import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireMember } from '@/server/members';
import { listCatalog } from '@/server/catalog';
import { catalogViewSchema } from '@/contracts/catalog';
import { AppError } from '@/server/errors';
import { Shell } from '@/components/shell';
import { CatalogManager } from '@/features/catalog/catalog-manager';
import { catalogUi } from '@/locales/ar/catalog';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const view = catalogViewSchema.safeParse((await searchParams).view).data ?? 'raw';
  return { title: catalogUi.tabs[view] };
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const member = await requireMember(await headers()).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    if (error instanceof AppError && error.status === 403) redirect('/access');
    throw error;
  });
  if (member.role === 'operator') redirect('/access');
  const params = await searchParams;
  const view = catalogViewSchema.safeParse(params.view).data ?? 'raw';
  const productView = view === 'raw' || view === 'finished';
  const initial = await listCatalog(member, productView ? 'products' : 'suppliers', {
    q: '',
    status: 'all',
    ...(productView ? { kind: view as 'raw' | 'finished' } : {}),
  });
  return (
    <Shell member={member} section="purchases">
      <CatalogManager key={view} initial={initial} userId={member.id} view={view} />
    </Shell>
  );
}
