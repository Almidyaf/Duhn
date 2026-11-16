'use client';
import { formatWeight } from '@/contracts/weight';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowLeft, ArrowRight, Check, Flame, RefreshCw } from 'lucide-react';
import type { CatalogItem, Cursor } from '@/contracts/catalog';
import {
  productionStartSchema,
  type ProductionOptions,
  type ProductionStartInput,
  type SourceChoice,
} from '@/contracts/production';
import { toMilligrams, fromMilligrams } from '@/contracts/weight';
import { formatLiveWeightInput, parseGroupedWeightInput, WeightHint } from '@/components/weight-hint';
import { CatalogPicker, Pagination, WriteFeedback } from '../catalog/shared';
import { FormSteps } from '@/components/form-steps';
import type { useProductionWrite } from './use-production-write';
import { productionUi as p } from '@/locales/ar/production';
import { workflowUi as w } from '@/locales/ar/workflow';
import { ui } from '@/locales/ar/ui';

type Review = {
  body: ProductionStartInput;
  options: ProductionOptions;
  source: SourceChoice;
  remaining: string;
};

async function fetchOptions(url: string): Promise<ProductionOptions> {
  const response = await fetch(url, { cache: 'no-store' });
  const body = (await response.json()) as ProductionOptions & { code?: string };
  if (!response.ok) throw new Error(body.code ?? 'SERVICE_UNAVAILABLE');
  return body;
}

export function StartForm({
  write,
  onClose,
}: {
  write: ReturnType<typeof useProductionWrite>;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [product, setProduct] = useState<CatalogItem | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [selected, setSelected] = useState('');
  const [weight, setWeight] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    title.current?.focus();
  }, [step]);

  const params = new URLSearchParams({ product_id: product?.id ?? '' });
  if (cursor) {
    params.set('before_at', cursor.at);
    params.set('before_id', cursor.id);
  }
  const { data, error, isLoading, mutate } = useSWR<ProductionOptions>(
    product ? `/api/v1/production-orders/options?${params}` : null,
    fetchOptions,
    { shouldRetryOnError: false },
  );

  const source =
    data?.sources.items.find((s) => s.id === selected) ??
    (!selected && data?.sources.items.length === 1 && !cursor && !data.sources.next_cursor
      ? data.sources.items[0]
      : undefined);

  const parsedWeight = (() => {
    try {
      return weight.trim() ? parseGroupedWeightInput(weight) : null;
    } catch {
      return null;
    }
  })();

  const liveRemaining =
    source && parsedWeight
      ? toMilligrams(source.quantity_g) - toMilligrams(parsedWeight)
      : null;

  function fillFraction(divisor: bigint) {
    if (!source) return;
    const totalMg = toMilligrams(source.quantity_g);
    const val = divisor === 1n ? source.quantity_g : fromMilligrams(totalMg / divisor);
    setWeight(formatLiveWeightInput(val.replace(/\.?0+$/, '')));
    write.setError('');
  }

  function changeProduct(v: CatalogItem | null) {
    setProduct(v);
    setCursor(null);
    setSelected('');
    setWeight('');
    setReview(null);
    write.setError('');
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (write.locked) return;
    write.setError('');
    if (step === 0) {
      if (!data || !source || !product || error) return;
      try {
        const body = productionStartSchema.parse({
          product_id: product.id,
          raw_lot_id: source.id,
          source_version: source.version,
          settings_version: data.settings_version,
          quantity_g: parseGroupedWeightInput(weight),
        });
        const remaining = toMilligrams(source.quantity_g) - toMilligrams(body.quantity_g);
        if (remaining < 0n) {
          write.setError(p.errors.INSUFFICIENT_BALANCE);
          return;
        }
        setReview({ body, options: data, source, remaining: fromMilligrams(remaining) });
        setStep(1);
      } catch {
        write.setError(p.errors.INVALID_INPUT);
      }
      return;
    }
    if (review) await write.submit('/api/v1/production-orders', 'POST', review.body);
  }

  return (
    <>
      <FormSteps labels={['الدهن والكمية', 'مراجعة وتأكيد']} current={step} />
      <form className="entry-form" onSubmit={submit}>
        <fieldset className="plain-fieldset" disabled={write.locked}>
          <h3 className="step-heading" tabIndex={-1} ref={title}>
            {step === 0 ? 'حدد الدهن ودفعة الخام والكمية' : 'مراجعة أمر الإنتاج قبل البدء'}
          </h3>

          {step === 0 && (
            <>
              <CatalogPicker
                label="دهن العود (المنتج النهائي)"
                placeholder="اختر الدهن المراد إنتاجه"
                emptyText="لا توجد دهون نشطة — أضف دهنًا واربطه بمادة خام أولًا."
                entity="products"
                kind="finished"
                value={product}
                onChange={changeProduct}
              />
              {isLoading && <p role="status">{p.loading}</p>}
              {error && (
                <p className="notice warning" role="alert">
                  {error.message === 'SETTINGS_REQUIRED' ? (
                    <>
                      {p.errors.SETTINGS_REQUIRED} <Link href="/settings">{ui.settings}</Link>
                    </>
                  ) : error.message === 'RAW_LINK_REQUIRED' ? (
                    <>
                      {p.errors.RAW_LINK_REQUIRED}{' '}
                      <Link href="/purchases/catalog?view=finished">ربط الدهن بالعود</Link>
                    </>
                  ) : (
                    p.errors[error.message] ?? p.loadError
                  )}
                </p>
              )}
              {data && (
                <>
                  <div className="selected-source">
                    <span>المادة الخام المرتبطة (العود)</span>
                    <strong>{data.raw_product.name}</strong>
                  </div>
                  {!data.sources.items.length ? (
                    <p className="notice warning">
                      {p.noSource} <Link href="/purchases">{ui.purchases}</Link>
                    </p>
                  ) : (
                    <>
                      <label>
                        {p.source}
                        <select
                          aria-label={p.source}
                          required
                          value={source?.id ?? ''}
                          onChange={(e) => {
                            setSelected(e.target.value);
                            setWeight('');
                            write.setError('');
                          }}
                        >
                          <option value="">اختر دفعة الخام</option>
                          {data.sources.items.map((s) => (
                            <option key={s.id} value={s.id}>
                              {`LOT-${s.code.padStart(4, '0')} · ${formatWeight(s.quantity_g)} ${p.gram}`}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Pagination
                        cursor={cursor}
                        next={data.sources.next_cursor}
                        onChange={(v) => {
                          setCursor(v);
                          setSelected('');
                          setWeight('');
                        }}
                      />
                      {source && (
                        <>
                          <div className="available-stock">
                            <span>{p.available}</span>
                            <strong>
                              <bdi>{formatWeight(source.quantity_g)}</bdi> {p.gram}
                            </strong>
                          </div>
                          <div className="button-row">
                            <button
                              type="button"
                              className="quiet-button"
                              onClick={() => fillFraction(1n)}
                            >
                              كامل الدفعة
                            </button>
                            <button
                              type="button"
                              className="quiet-button"
                              onClick={() => fillFraction(2n)}
                            >
                              نصف الدفعة
                            </button>
                          </div>
                          <label>
                            {p.quantity}
                            <span className="weight-input large">
                              <input
                                aria-label={p.quantity}
                                dir="ltr"
                                inputMode="decimal"
                                value={weight}
                                required
                                maxLength={25}
                                placeholder={w.weightPlaceholder}
                                onChange={(e) => setWeight(formatLiveWeightInput(e.target.value))}
                              />
                              <span>{p.gram}</span>
                            </span>
                            <WeightHint value={weight} />
                          </label>
                          {liveRemaining !== null && (
                            <small className={liveRemaining < 0n ? 'notice danger' : 'field-hint'}>
                              {liveRemaining < 0n
                                ? p.errors.INSUFFICIENT_BALANCE
                                : `${w.afterStart}: ${formatWeight(fromMilligrams(liveRemaining))} ${p.gram}`}
                            </small>
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {step === 1 && review && (
            <div className="entry-review">
              <div className="review-product">
                <span className="review-icon">
                  <Flame size={24} />
                </span>
                <div>
                  <small>الدهن المطلوب</small>
                  <strong>{review.options.product.name}</strong>
                </div>
                <span className="status-pill active">بانتظار الفرن</span>
              </div>
              <dl className="review-facts">
                <div>
                  <dt>{p.raw}</dt>
                  <dd>{review.options.raw_product.name}</dd>
                </div>
                <div>
                  <dt>{p.source}</dt>
                  <dd dir="ltr">LOT-{review.source.code.padStart(4, '0')}</dd>
                </div>
                <div>
                  <dt>{p.timezone}</dt>
                  <dd>{review.options.timezone}</dd>
                </div>
              </dl>
              <div className="review-total">
                <span>الكمية المسحوبة للإنتاج</span>
                <strong>
                  <bdi>{formatWeight(review.body.quantity_g)}</bdi> {p.gram}
                </strong>
              </div>
              <div className="review-remainder">
                <span>{w.afterStart}</span>
                <strong>
                  <bdi>{formatWeight(review.remaining)}</bdi> {p.gram}
                </strong>
              </div>
            </div>
          )}
        </fieldset>

        <WriteFeedback write={write} />
        <div className="dialog-actions wizard-actions">
          {step > 0 ? (
            <button
              type="button"
              className="secondary-button"
              disabled={write.busy}
              onClick={() => {
                write.setError('');
                setStep(step - 1);
              }}
            >
              <ArrowRight size={17} />
              {w.back}
            </button>
          ) : (
            <button
              type="button"
              className="secondary-button"
              disabled={write.busy}
              onClick={onClose}
            >
              {ui.cancel}
            </button>
          )}
          <div className="button-row">
            {step === 0 && error && (
              <button type="button" className="quiet-button" onClick={() => mutate()}>
                <RefreshCw size={16} />
                {ui.retry}
              </button>
            )}
            {step < 1 ? (
              <button
                className="primary-button"
                disabled={
                  write.locked ||
                  !product ||
                  !data ||
                  !!error ||
                  !source ||
                  !weight ||
                  liveRemaining === null ||
                  liveRemaining < 0n
                }
              >
                {w.next}
                <ArrowLeft size={17} />
              </button>
            ) : (
              <button className="primary-button" disabled={write.locked}>
                <Check size={17} />
                {write.busy ? ui.saving : 'إنشاء أمر الإنتاج'}
              </button>
            )}
          </div>
        </div>
      </form>
    </>
  );
}
