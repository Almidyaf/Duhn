import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { requireMember } from '@/server/members';
import { getCatalogItem, listRecipes } from '@/server/catalog';
import { AppError } from '@/server/errors';
import { Shell } from '@/components/shell';
import { RecipesManager } from '@/features/catalog/recipes-manager';
import { catalogUi } from '@/locales/ar/catalog';
export const dynamic = 'force-dynamic';
export const metadata = { title: catalogUi.recipeTitle };
export default async function RecipesPage({ params }: { params: Promise<{ productId: string }> }) {
  const member = await requireMember(await headers()).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    if (error instanceof AppError && error.status === 403) redirect('/access');
    throw error;
  });
  if (member.role === 'operator') redirect('/access');
  const parsed = z.uuid().safeParse((await params).productId);
  if (!parsed.success) notFound();
  const [product, initial] = await Promise.all([
    getCatalogItem(member, 'products', parsed.data).catch((error) => {
      if (error instanceof AppError && error.status === 404) notFound();
      throw error;
    }),
    listRecipes(member, parsed.data),
  ]);
  if (product.kind !== 'finished') notFound();
  return (
    <Shell member={member} section="purchases">
      <RecipesManager
        initial={initial}
        product={product}
        userId={member.id}
        isOwner={member.role === 'owner'}
      />
    </Shell>
  );
}
