'use client';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Plus, X, ArrowRight, Copy } from 'lucide-react';
import {
  recipeInputSchema,
  type CatalogItem,
  type RecipeVersion,
  type RecipePage,
  type Cursor,
} from '@/contracts/catalog';
import { RecipeApprovalDialog } from '../settings/recipe-approval-dialog';
import { settingsUi as s } from '@/locales/ar/settings';
import { ui } from '@/locales/ar/ui';
import { catalogUi as c } from '@/locales/ar/catalog';
import { useCatalogWrite } from './use-catalog-write';
import { CatalogPicker, fetchJson, Pagination, WriteFeedback } from './shared';
import { PurchaseNav } from '../receipts/purchase-nav';
export function RecipesManager({
  initial,
  product: initialProduct,
  userId,
  isOwner,
}: {
  initial: RecipePage;
  product: CatalogItem;
  userId: string;
  isOwner: boolean;
}) {
  const [approval, setApproval] = useState<RecipeVersion | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<RecipeVersion | null>(null);
  const [rawType, setRawType] = useState<CatalogItem | null>(null);
  const [raw, setRaw] = useState<CatalogItem | null>(null);
  const [editVersion, setEditVersion] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const base = `/api/v1/catalog/products/${initialProduct.id}`;
  const { data: productData, mutate: refreshProduct } = useSWR<{ item: CatalogItem }>(
    base,
    fetchJson,
    { fallbackData: { item: initialProduct } },
  );
  const product = productData?.item ?? initialProduct;
  const params = new URLSearchParams();
  if (cursor) {
    params.set('before_at', cursor.at);
    params.set('before_id', cursor.id);
  }
  const url = `${base}/recipes${cursor ? `?${params}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR<RecipePage>(url, fetchJson, {
    fallbackData: cursor ? undefined : initial,
  });
  const write = useCatalogWrite(userId, async () => {
    setOpen(false);
    await Promise.all([mutate(), refreshProduct()]);
  });
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  async function begin(source: RecipeVersion | null) {
    // Freeze the exact server version when the form opens; focus refresh must not replace it.
    try {
      const [fresh, rawResult] = await Promise.all([
        refreshProduct(),
        source
          ? fetchJson<{ item: CatalogItem }>(`/api/v1/catalog/products/${source.raw_product_id}`)
          : Promise.resolve(null),
      ]);
      if (!fresh) throw new Error();
      const typeResult = rawResult?.item.type_id
        ? await fetchJson<{ item: CatalogItem }>(`/api/v1/catalog/types/${rawResult.item.type_id}`)
        : null;
      setEditVersion(fresh.item.version);
      setRawType(typeResult?.item.active ? typeResult.item : null);
      setRaw(rawResult?.item.active && typeResult?.item.active ? rawResult.item : null);
    } catch {
      write.setError(c.loadError);
      return;
    }
    write.setError('');
    setSource(source);
    setOpen(true);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (write.locked) return;
    const form = new FormData(event.currentTarget);
    const timing = (stage: 'fermentation' | 'oven') => ({
      duration_minutes: Number(form.get(`${stage}.duration_minutes`)),
      warning_minutes: Number(form.get(`${stage}.warning_minutes`)),
      grace_minutes: Number(form.get(`${stage}.grace_minutes`)),
      time_basis: form.get(`${stage}.time_basis`),
      resume_policy: form.get(`${stage}.resume_policy`),
    });
    const parsed = recipeInputSchema.safeParse({
      expected_version: editVersion,
      raw_product_id: raw?.id,
      policy: { fermentation: timing('fermentation'), oven: timing('oven') },
      note: form.get('note'),
    });
    if (!parsed.success) {
      write.setError(c.errors.INVALID_INPUT);
      return;
    }
    await write.submit(`${base}/recipes`, 'POST', parsed.data);
  }
  return (
    <>
      <PurchaseNav active="finished" />
      <Link className="quiet-button" href="/purchases/catalog?view=finished">
        <ArrowRight size={16} />
        {c.backToOils}
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{c.recipes}</p>
          <h1>{product.name}</h1>
          <p className="muted">{c.recipeLead}</p>
        </div>
        <button
          className="primary-button"
          disabled={write.locked || !product.active}
          onClick={() => begin(null)}
        >
          <Plus size={18} />
          {c.newRecipe}
        </button>
      </div>
      {!open && <WriteFeedback write={write} />}
      <RecipeApprovalDialog
        selected={approval}
        productId={product.id}
        userId={userId}
        onClose={() => setApproval(null)}
        onSaved={async () => {
          await Promise.all([mutate(), refreshProduct()]);
        }}
      />
      <section className="recipe-list" aria-label={c.recipeTitle}>
        {error ? (
          <div className="notice danger" role="alert">
            {c.loadError}
            <button className="quiet-button" onClick={() => mutate()}>
              {ui.retry}
            </button>
          </div>
        ) : isLoading && !data ? (
          <p role="status">{c.loading}</p>
        ) : !data?.items.length ? (
          <div className="assets-panel empty-state">
            <h2>{c.recipeEmpty}</h2>
            <p className="muted">{c.recipeHint}</p>
          </div>
        ) : (
          data.items.map((recipe) => (
            <article key={recipe.id} className="recipe-card">
              <div className="catalog-heading">
                <h2>
                  {c.revision} {recipe.revision}
                </h2>
                <span className={`status-pill ${recipe.active ? 'active' : 'inactive'}`}>
                  {recipe.active ? s.active : recipe.status === 'approved' ? s.approved : c.draft}
                </span>
              </div>
              <p>
                {c.rawProduct}: <strong>{recipe.raw_snapshot.name}</strong>
              </p>
              <div className="recipe-policy-grid">
                {(['fermentation', 'oven'] as const).map((stage) => (
                  <div key={stage}>
                    <h3>{c[stage]}</h3>
                    <dl>
                      <dt>{c.duration}</dt>
                      <dd>{recipe.policy[stage].duration_minutes}</dd>
                      <dt>{c.timeBasis}</dt>
                      <dd>{recipe.policy[stage].time_basis === 'active' ? c.active : c.elapsed}</dd>
                      <dt>{c.resumePolicy}</dt>
                      <dd>
                        {recipe.policy[stage].resume_policy === 'continue'
                          ? c.continue
                          : c.requireReview}
                      </dd>
                      <dt>{c.warning}</dt>
                      <dd>{recipe.policy[stage].warning_minutes}</dd>
                      <dt>{c.grace}</dt>
                      <dd>{recipe.policy[stage].grace_minutes}</dd>
                    </dl>
                  </div>
                ))}
              </div>
              {recipe.note && <p className="recipe-note">{recipe.note}</p>}
              {isOwner && (
                <button
                  className="secondary-button"
                  disabled={write.locked || !product.active}
                  onClick={() => setApproval(recipe)}
                >
                  {recipe.active
                    ? s.disable
                    : recipe.status === 'approved'
                      ? s.reactivate
                      : s.approve}
                </button>
              )}
              <button
                className="secondary-button"
                disabled={write.locked || !product.active}
                onClick={() => begin(recipe)}
              >
                <Copy size={16} />
                {c.useRecipe}
              </button>
            </article>
          ))
        )}
        <Pagination cursor={cursor} next={data?.next_cursor ?? null} onChange={setCursor} />
      </section>
      <dialog
        ref={dialog}
        className="asset-dialog recipe-dialog"
        aria-labelledby="recipe-dialog-title"
        onCancel={(e) => {
          if (write.busy) e.preventDefault();
          else setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-heading">
          <h2 id="recipe-dialog-title">{c.newRecipe}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={ui.cancel}
            disabled={write.busy}
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <form key={`${source?.id ?? 'new'}:${open}`} onSubmit={submit}>
          <p className="muted">{c.recipeHint}</p>
          <fieldset className="plain-fieldset" disabled={write.busy || !!write.pending}>
            <CatalogPicker
              label={c.rawType}
              entity="types"
              value={rawType}
              onChange={(type) => {
                setRawType(type);
                setRaw(null);
              }}
            />
            <CatalogPicker
              key={rawType?.id ?? 'empty'}
              label={c.rawProduct}
              entity="products"
              typeId={rawType?.id}
              kind="raw"
              value={raw}
              onChange={setRaw}
            />
            {(['fermentation', 'oven'] as const).map((stage) => (
              <fieldset className="timing-fields" key={stage}>
                <legend>{c[stage]}</legend>
                <div className="recipe-policy-grid">
                  {(['duration_minutes', 'warning_minutes', 'grace_minutes'] as const).map(
                    (field, i) => (
                      <label key={field}>
                        {[c.duration, c.warning, c.grace][i]}
                        <input
                          aria-label={[c.duration, c.warning, c.grace][i]}
                          aria-describedby={`${stage}-${field}-hint`}
                          name={`${stage}.${field}`}
                          type="number"
                          min={i === 0 ? 1 : 0}
                          max={i === 2 ? 10080 : 525600}
                          step="1"
                          required
                          defaultValue={source?.policy[stage][field]}
                        />
                        <small id={`${stage}-${field}-hint`} className="field-hint">
                          {c.timingHints[i]}
                        </small>
                      </label>
                    ),
                  )}
                </div>
                <label>
                  {c.timeBasis}
                  <select
                    aria-label={c.timeBasis}
                    aria-describedby={`${stage}-basis-hint`}
                    name={`${stage}.time_basis`}
                    required
                    defaultValue={source?.policy[stage].time_basis ?? ''}
                  >
                    <option value="" disabled>
                      {c.choose}
                    </option>
                    <option value="active">{c.active}</option>
                    <option value="elapsed">{c.elapsed}</option>
                  </select>
                  <small id={`${stage}-basis-hint`} className="field-hint">
                    {c.timeBasisHint}
                  </small>
                </label>
                <label>
                  {c.resumePolicy}
                  <select
                    aria-label={c.resumePolicy}
                    aria-describedby={`${stage}-resume-hint`}
                    name={`${stage}.resume_policy`}
                    required
                    defaultValue={source?.policy[stage].resume_policy ?? ''}
                  >
                    <option value="" disabled>
                      {c.choose}
                    </option>
                    <option value="continue">{c.continue}</option>
                    <option value="require_review">{c.requireReview}</option>
                  </select>
                  <small id={`${stage}-resume-hint`} className="field-hint">
                    {c.resumeHint}
                  </small>
                </label>
              </fieldset>
            ))}
            <label>
              {ui.notes}
              <span className="optional">{ui.optional}</span>
              <textarea name="note" maxLength={1000} rows={2} defaultValue={source?.note} />
            </label>
          </fieldset>
          {open && <WriteFeedback write={write} />}
          <div className="dialog-actions">
            <button className="primary-button" disabled={write.locked || !raw}>
              {write.busy ? ui.saving : c.saveRecipe}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={write.busy}
              onClick={() => setOpen(false)}
            >
              {ui.cancel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
