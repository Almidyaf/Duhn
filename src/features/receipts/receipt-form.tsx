'use client';
import { formatWeight } from '@/contracts/weight';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Trash2, Check, PackagePlus } from 'lucide-react';
import { receiptInputSchema, type ReceiptInput } from '@/contracts/receipts';
import { catalogInputSchemas, type CatalogItem } from '@/contracts/catalog';
import { useCatalogWrite } from '../catalog/use-catalog-write';
import { normalizeWeightInput, toMilligrams, fromMilligrams } from '@/contracts/weight';
import { formatLiveWeightInput, parseGroupedWeightInput, WeightHint } from '@/components/weight-hint';
import { FormSteps } from '@/components/form-steps';
import { CatalogPicker, WriteFeedback } from '../catalog/shared';
import type { useReceiptWrite } from './use-receipt-write';
import { receiptUi as r } from '@/locales/ar/receipts';
import { workflowUi as w } from '@/locales/ar/workflow';
import { ui } from '@/locales/ar/ui';
type Line = { key: string; product: CatalogItem | null; weight: string };
const empty = (key: string): Line => ({ key, product: null, weight: '' });
export function ReceiptForm({
  kind,
  userId,
  write,
  onClose,
}: {
  kind: 'purchase' | 'opening';
  userId: string;
  write: ReturnType<typeof useReceiptWrite>;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0),
    [supplier, setSupplier] = useState<CatalogItem | null>(null),
    [reference, setReference] = useState(''),
    [note, setNote] = useState('');
  const [openingReason, setOpeningReason] = useState('');
  const [lines, setLines] = useState<Line[]>([empty('first')]);
  const [review, setReview] = useState<ReceiptInput | null>(null);
  const [creating, setCreating] = useState<{
    lineKey: string;
  } | null>(null);
  const [newName, setNewName] = useState('');
  const catalogWrite = useCatalogWrite(userId, async (result, request) => {
    const saved = (
      result && typeof result === 'object' && 'item' in result ? result.item : result
    ) as CatalogItem | undefined;
    if (creating && saved?.id && request?.url === '/api/v1/catalog/products') {
      change(creating.lineKey, { product: saved });
      setCreating(null);
      setNewName('');
    }
  });
  function beginCreate(line: Line) {
    catalogWrite.setError('');
    setNewName('');
    setCreating({ lineKey: line.key });
  }
  async function saveChoice() {
    if (!creating || catalogWrite.locked) return;
    const body = catalogInputSchemas.products.safeParse({
      name: newName,
      kind: 'raw',
    });
    if (!body.success) {
      catalogWrite.setError(r.invalidChoiceName);
      return;
    }
    await catalogWrite.submit('/api/v1/catalog/products', 'POST', body.data);
  }
  const entryLocked = write.locked || catalogWrite.locked || !!creating;

  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, [step]);
  function change(key: string, fields: Partial<Line>) {
    setLines((old) => old.map((l) => (l.key === key ? { ...l, ...fields } : l)));
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (entryLocked) return;
    write.setError('');
    if (step === 0) {
      if (kind === 'purchase' && !supplier) {
        write.setError('اختر المورد أولًا.');
        return;
      }
      if (kind === 'opening' && !openingReason) {
        write.setError('اختر سبب التسجيل أولًا.');
        return;
      }
      if (kind === 'opening' && note.trim().length < 3) {
        write.setError('أدخل تفاصيل السبب (3 أحرف على الأقل).');
        return;
      }
      setStep(1);
      return;
    }
    if (step === 1) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const num = lines.length > 1 ? ` في المادة ${i + 1}` : '';
        if (!line.product) {
          write.setError(`اختر اسم المادة الخام${num}.`);
          return;
        }
        try {
          parseGroupedWeightInput(line.weight);
        } catch {
          write.setError(`أدخل وزنًا صحيحًا بالجرام${num}.`);
          return;
        }
      }
      try {
        const body = receiptInputSchema.parse({
          kind,
          supplier_id: kind === 'purchase' ? supplier?.id : null,
          reference: kind === 'purchase' ? reference : '',
          note,
          lines: lines.map((l) => ({
            product_id: l.product?.id,
            quantity_g: parseGroupedWeightInput(l.weight),
          })),
        });
        setReview(body);
        setStep(2);
      } catch {
        write.setError(r.errors.INVALID_INPUT);
      }
      return;
    }
    if (review) await write.submit('/api/v1/receipts', 'POST', review);
  }
  const total = review
    ? fromMilligrams(review.lines.reduce((sum, l) => sum + toMilligrams(l.quantity_g), 0n))
    : '0.000';
  return (
    <>
      <FormSteps labels={w.receiptSteps} current={step} />
      <form className="entry-form" onSubmit={submit}>
        <div className="step-heading">
          <h3 ref={title} tabIndex={-1}>
            {w.receiptSteps[step]}
          </h3>
          <p>
            {step === 0
              ? kind === 'opening'
                ? w.openingIntro
                : w.receiptIntro
              : step === 1
                ? w.materialsIntro
                : w.reviewIntro}
          </p>
        </div>
        <fieldset className="plain-fieldset" disabled={write.busy || !!write.pending}>
          {step === 0 && (
            <>
              {kind === 'purchase' ? (
                <>
                  <CatalogPicker
                    label={r.supplier}
                    entity="suppliers"
                    value={supplier}
                    onChange={setSupplier}
                  />
                  <label>
                    {r.reference}
                    <span className="optional">{ui.optional}</span>
                    <input
                      name="reference"
                      placeholder={r.referenceExample}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      maxLength={120}
                    />
                    <small className="field-hint">{r.referenceHint}</small>
                  </label>
                </>
              ) : (
                <div className="form-context">
                  <PackagePlus size={20} />
                  <p>{r.openingLead}</p>
                </div>
              )}
              {kind === 'opening' && (
                <label>
                  {r.openingReason}
                  <select
                    aria-label={r.openingReason}
                    required
                    value={openingReason}
                    onChange={(e) => {
                      setOpeningReason(e.target.value);
                      setNote(e.target.value === 'existing' ? r.existingStock : '');
                    }}
                  >
                    <option value="" disabled>
                      {r.chooseOpeningReason}
                    </option>
                    <option value="existing">{r.existingStock}</option>
                    <option value="other">{r.otherReason}</option>
                  </select>
                </label>
              )}
              {(kind === 'purchase' || openingReason === 'other') && (
                <label>
                  {kind === 'opening' ? r.reasonDetails : r.note}
                  {kind === 'purchase' && <span className="optional">{ui.optional}</span>}
                  <textarea
                    name="note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={kind === 'opening' ? r.reasonExample : r.noteExample}
                    required={kind === 'opening'}
                    minLength={kind === 'opening' ? 3 : undefined}
                    rows={2}
                    maxLength={1000}
                  />
                </label>
              )}
            </>
          )}
          {step === 1 && (
            <>
              <div className="selected-source">
                <span>{r.source}</span>
                <strong>{kind === 'opening' ? r.opening : supplier?.name}</strong>
                {reference && <small>{reference}</small>}
              </div>
              {lines.map((line, index) => (
                <section
                  className="entry-line"
                  key={line.key}
                  aria-label={`${r.line} ${index + 1}`}
                >
                  <div className="entry-line-heading">
                    <strong>
                      <span className="line-number">{index + 1}</span>
                      {lines.length === 1 ? r.materialEntry : `${r.line} ${index + 1}`}
                    </strong>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="icon-button remove-line"
                        aria-label={`${r.removeLine} ${index + 1}`}
                        onClick={() => setLines((old) => old.filter((l) => l.key !== line.key))}
                      >
                        <Trash2 size={17} />
                      </button>
                    )}
                  </div>
                  <div>
                    <CatalogPicker
                      label={r.rawName}
                      placeholder={r.chooseRaw}
                      emptyText={r.noRaw}
                      entity="products"
                      kind="raw"
                      value={line.product}
                      disabled={catalogWrite.locked || !!creating}
                      onChange={(product) => change(line.key, { product })}
                    />
                    <small className="field-hint">{r.rawHelp}</small>
                    <button
                      type="button"
                      className="quiet-button inline-add"
                      disabled={catalogWrite.locked || !!creating}
                      onClick={() => beginCreate(line)}
                    >
                      <Plus size={16} />
                      {r.addRaw}
                    </button>
                  </div>
                  {creating?.lineKey === line.key && (
                    <div
                      className="inline-catalog-editor"
                      role="group"
                      aria-label={r.addRaw}
                    >
                      <label>
                        {r.newRawName}
                        <input
                          autoFocus
                          value={newName}
                          maxLength={120}
                          placeholder={r.rawExample}
                          disabled={catalogWrite.busy || !!catalogWrite.pending}
                          onChange={(e) => setNewName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void saveChoice();
                            }
                          }}
                        />
                      </label>
                      <div className="button-row">
                        <button
                          type="button"
                          className="primary-button"
                          disabled={catalogWrite.locked}
                          onClick={saveChoice}
                        >
                          {catalogWrite.busy ? ui.saving : r.saveChoice}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={catalogWrite.busy || !!catalogWrite.pending}
                          onClick={() => setCreating(null)}
                        >
                          {ui.cancel}
                        </button>
                      </div>
                    </div>
                  )}
                  <label>
                    {r.weight}
                    <span className="weight-input">
                      <input
                        aria-label={r.weight}
                        inputMode="decimal"
                        dir="ltr"
                        value={line.weight}
                        required
                        maxLength={25}
                        placeholder={w.weightPlaceholder}
                        onChange={(e) =>
                          change(line.key, { weight: formatLiveWeightInput(e.target.value) })
                        }
                      />
                      <span>{w.unit}</span>
                    </span>
                    <WeightHint value={line.weight} />
                  </label>
                </section>
              ))}
              <div className="entry-add-row">
                {lines.length < 25 && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setLines((old) => [...old, empty(crypto.randomUUID())])}
                  >
                    <Plus size={17} />
                    {r.addLine}
                  </button>
                )}
                <small className="field-hint">{r.weightHint}</small>
              </div>
            </>
          )}
          {step === 2 && review && (
            <div className="entry-review">
              <dl className="review-facts">
                <div>
                  <dt>{r.source}</dt>
                  <dd>{kind === 'opening' ? r.opening : supplier?.name}</dd>
                </div>
                {reference && (
                  <div>
                    <dt>{r.reference}</dt>
                    <dd>{reference}</dd>
                  </div>
                )}
                <div>
                  <dt>{w.lineCount}</dt>
                  <dd>{lines.length}</dd>
                </div>
              </dl>
              <div className="review-lines">
                {lines.map((line, i) => (
                  <div key={line.key}>
                    <span>
                      <strong>{line.product?.name}</strong>
                    </span>
                    <strong>
                      <bdi>{formatWeight(review.lines[i].quantity_g)}</bdi> {w.unit}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="review-total">
                <span>{w.total}</span>
                <strong>
                  <bdi>{formatWeight(total)}</bdi> {w.unit}
                </strong>
              </div>
              {note && <p className="recipe-note">{note}</p>}
              <p className="field-hint">{w.autoRecord}</p>
            </div>
          )}
        </fieldset>
        <WriteFeedback write={catalogWrite} />
        <WriteFeedback write={write} />
        <div className="dialog-actions wizard-actions">
          {step > 0 ? (
            <button
              type="button"
              className="secondary-button"
              disabled={entryLocked}
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
          <button className="primary-button" disabled={entryLocked}>
            {write.busy
              ? ui.saving
              : step === 2
                ? kind === 'opening'
                  ? r.saveOpening
                  : r.save
                : step === 1
                  ? w.review
                  : w.next}
            {step === 2 ? <Check size={17} /> : <ArrowLeft size={17} />}
          </button>
        </div>
      </form>
    </>
  );
}
