import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { assertTestDatabase } from '../scripts/env';
import type { Member } from '../src/server/members';
import { createCatalogItem, createRecipe } from '../src/server/catalog';
import { getFactorySettings, updateFactorySettings, approveRecipe } from '../src/server/settings';
import { createReceipt } from '../src/server/receipts';
import { fermentationOptions, startFermentation } from '../src/server/fermentation';
export async function configureFactory(owner: Member) {
  assertTestDatabase();
  const before = await getFactorySettings(owner);
  return updateFactorySettings(owner, randomUUID(), {
    name: 'مصنع الاختبار',
    timezone: 'UTC',
    week_starts_on: 0,
    measurement_confirmed: true,
    expected_version: before.version,
  });
}
export async function productionFixture(owner: Member, activate = true) {
  assertTestDatabase();
  const settings = await configureFactory(owner);
  const type = await createCatalogItem(owner, randomUUID(), 'types', {
    name: `نوع إنتاج ${randomUUID().slice(0, 8)}`,
  });
  const raw = await createCatalogItem(owner, randomUUID(), 'products', {
    name: `خشب ${randomUUID().slice(0, 8)}`,
    kind: 'raw',
  });
  const product = await createCatalogItem(owner, randomUUID(), 'products', {
    name: `دهن ${randomUUID().slice(0, 8)}`,
    kind: 'finished',
    raw_product_id: raw.id,
  });
  const timing = {
    duration_minutes: 60,
    warning_minutes: 15,
    grace_minutes: 10,
    time_basis: 'elapsed' as const,
    resume_policy: 'require_review' as const,
  };
  const created = await createRecipe(owner, randomUUID(), product.id, {
    expected_version: product.version,
    raw_product_id: raw.id,
    policy: { fermentation: timing, oven: { ...timing, time_basis: 'active' } },
    note: 'وصفة اختبار فقط؛ ليست إعدادًا صناعيًا',
  });
  if (activate)
    await approveRecipe(owner, randomUUID(), product.id, created.recipe.id, {
      expected_version: created.product_version,
      settings_version: settings.version,
      note: 'اعتماد للاختبار فقط',
      process_confirmed: true,
    });
  const receipt = await createReceipt(owner, randomUUID(), {
    kind: 'opening',
    supplier_id: null,
    reference: '',
    note: 'رصيد اختبار',
    lines: [{ product_id: raw.id, quantity_g: '25000.000' }],
  });
  return {
    settings,
    type,
    raw,
    product,
    recipe: created.recipe,
    product_version: created.product_version,
    receipt,
  };
}
export async function startFixture(owner: Member) {
  const fixture = await productionFixture(owner);
  const options = await fermentationOptions(owner, fixture.product.id);
  const source = options.sources.items[0];
  const input = {
    product_id: fixture.product.id,
    recipe_id: fixture.recipe.id,
    raw_lot_id: source.id,
    source_version: source.version,
    settings_version: options.settings_version,
    quantity_g: '25000.000',
  };
  const batch = await startFermentation(owner, randomUUID(), input);
  return { ...fixture, input, batch };
}
// Test-only time travel: never exported from application code and guarded against non-test DBs.
export async function matureFermentation(id: string) {
  assertTestDatabase();
  const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  try {
    await admin.query(
      "UPDATE stage_runs SET started_at=now()-interval '2 hours',due_at=now()-interval '1 hour' WHERE fermentation_id=$1",
      [id],
    );
  } finally {
    await admin.end();
  }
}
