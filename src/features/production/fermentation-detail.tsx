'use client';
import { formatWeight } from '@/contracts/weight';
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowRight, Clock3, FlaskConical } from 'lucide-react';
import type { Cursor } from '@/contracts/catalog';
import type { FermentationDetail, ProductionOrder } from '@/contracts/fermentation';
import { OvenStartForm } from './oven-start-form';
import { ProductionPaths } from './production-paths';
import { OrderProcessing, processingLabels } from './order-processing';
import { StageProgress } from './stage-progress';
import { normalizeWeightInput, toMilligrams, fromMilligrams } from '@/contracts/weight';
import {
  formatGroupedWeight,
  formatLiveWeightInput,
  parseGroupedWeightInput,
  WeightHint,
} from '@/components/weight-hint';
import { CopyCodeButton } from '@/components/copy-code-button';
import { fetchJson, Pagination, WriteFeedback } from '../catalog/shared';
import { useProductionWrite } from './use-production-write';
import { BatchStatus, batchCode, localDate, useServerClock, duration } from './shared';
import { productionUi as p } from '@/locales/ar/production';
import { ui } from '@/locales/ar/ui';
export function FermentationDetailView({
  initial,
  userId,
  initialOrderId,
}: {
  initial: FermentationDetail;
  userId: string;
  initialOrderId?: string;
}) {
  const [cursor, setCursor] = useState<Cursor | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [weight, setWeight] = useState('');
  const [ovenOrder, setOvenOrder] = useState<ProductionOrder | null>(null);
  const [collapseCompleted, setCollapseCompleted] = useState(true);
  const [expandedParts, setExpandedParts] = useState<Record<string, boolean>>(() =>
    initialOrderId ? { [initialOrderId]: true } : {},
  );
  useEffect(() => {
    if (!initialOrderId) return;
    requestAnimationFrame(() =>
      document
        .getElementById('part-details-' + initialOrderId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  }, [initialOrderId]);
  const root = `/api/v1/fermentations/${initial.fermentation.id}`;
  const params = new URLSearchParams();
  if (cursor) {
    params.set('before_at', cursor.at);
    params.set('before_id', cursor.id);
  }
  const {
    data = initial,
    error,
    isLoading,
    mutate,
  } = useSWR<FermentationDetail>(`${root}?${params}`, fetchJson, {
    fallbackData: cursor ? undefined : initial,
    refreshInterval: 30000,
  });
  const f = data.fermentation,
    now = useServerClock(data.server_time),
    delta = Date.parse(f.due_at) - now;
  const write = useProductionWrite(userId, async () => {
    setOvenOrder(null);
    setConfirmed(false);
    setWeight('');
    setCursor(null);
    await mutate();
  });
  const withdrawn = fromMilligrams(toMilligrams(f.quantity_g) - toMilligrams(f.balance_g));
  let remainingAfter: string | null = null;
  try {
    if (weight.trim())
      remainingAfter = fromMilligrams(
        toMilligrams(f.balance_g) - toMilligrams(parseGroupedWeightInput(weight)),
      );
  } catch {
    /* Show validation on submit, not while a number is being typed. */
  }
  const locked = write.locked || !!error || isLoading;
  async function inspect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked || !confirmed) return;
    await write.submit(`${root}/ready`, 'POST', {
      expected_version: f.version,
      inspection_confirmed: true,
    });
  }
  async function withdraw(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked) return;
    try {
      const normalized = parseGroupedWeightInput(weight);
      if (toMilligrams(normalized) > toMilligrams(f.balance_g)) {
        write.setError(p.errors.INSUFFICIENT_BALANCE);
        return;
      }
      await write.submit(`${root}/withdrawals`, 'POST', {
        expected_version: f.version,
        quantity_g: normalized,
      });
    } catch {
      write.setError(p.errors.INVALID_INPUT);
    }
  }
  return (
    <>
      <Link href="/production" className="quiet-button">
        <ArrowRight size={16} />
        {p.back}
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <span dir="ltr">{batchCode(f.code)}</span> · {p.recipe} {f.recipe_revision}{' '}
            <CopyCodeButton code={batchCode(f.code)} label="نسخ رقم الدفعة" />
          </p>
          <h1>{f.product_name}</h1>
          <p className="muted">
            {p.timezone}: {f.timezone}
          </p>
        </div>
        <BatchStatus batch={f} now={now} />
      </div>
      {!ovenOrder && <WriteFeedback write={write} />}
      {error && (
        <p className="notice danger" role="alert">
          {p.loadError}
        </p>
      )}
      <ProductionPaths
        batch={f}
        orders={data.orders.items}
        now={now}
        locked={locked}
        onOpenOrder={(id) => {
          setExpandedParts((prev) => ({ ...prev, [id]: true }));
          requestAnimationFrame(() =>
            document
              .getElementById('part-details-' + id)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
          );
        }}
        onStartOven={(order) => {
          write.setError('');
          setOvenOrder(order);
        }}
      />
      <div className="production-summary">
        <div>
          <small>{p.initial}</small>
          <strong>
            <span dir="ltr">{formatWeight(f.quantity_g)}</span> {p.gram}
          </strong>
        </div>
        <div className="production-balance">
          <FlaskConical size={22} />
          <small>{p.balance}</small>
          <strong data-testid="fermentation-balance">
            <span dir="ltr">{formatWeight(f.balance_g)}</span> {p.gram}
          </strong>
        </div>
        <div>
          <small>{p.started}</small>
          <time dateTime={f.started_at}>{localDate(f.started_at, f.timezone)}</time>
        </div>
      </div>
      {f.status !== 'depleted' && (
        <div className="notice">
          <p>{p.continuousHint}</p>
          <p>
            {p.aging}: <strong dir="ltr">{duration(now - Date.parse(f.started_at))}</strong> ·{' '}
            {p.totalWithdrawn}: <strong dir="ltr">{formatWeight(withdrawn)}</strong> {p.gram}
          </p>
        </div>
      )}
      {f.status === 'fermenting' && (
        <section className="production-action" aria-labelledby="inspection-title">
          <div className="production-clock">
            <Clock3 size={24} />
            <div>
              <small>{delta > 0 ? p.remaining : p.overdue}</small>
              <strong dir="ltr" role="timer" aria-live="off">
                {duration(delta)}
              </strong>
              <small>
                {p.due}: {localDate(f.due_at, f.timezone)}
              </small>
              <StageProgress
                start={Date.parse(f.started_at)}
                due={Date.parse(f.due_at)}
                now={now}
                kind="fermentation"
              />
            </div>
          </div>
          <form onSubmit={inspect}>
            <h2 id="inspection-title">{p.inspection}</h2>
            <p className="muted">{p.inspectHint}</p>
            {delta > 0 && <p className="field-hint">{p.notMature}</p>}
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={locked || delta > 0}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>{p.inspectConfirm}</span>
            </label>
            <button className="primary-button" disabled={locked || !confirmed || delta > 0}>
              {write.busy ? ui.saving : p.inspection}
            </button>
          </form>
        </section>
      )}
      {f.status === 'ready' && (
        <section className="production-action" aria-labelledby="withdraw-title">
          <div>
            <h2 id="withdraw-title">{p.withdraw}</h2>
            <p className="muted">{p.withdrawHint}</p>
          </div>
          <form onSubmit={withdraw}>
            <label>
              {p.withdrawQuantity}
              <input
                dir="ltr"
                inputMode="decimal"
                maxLength={25}
                required
                value={weight}
                disabled={locked}
                onChange={(e) => setWeight(formatLiveWeightInput(e.target.value))}
              />
              <WeightHint value={weight} />
            </label>
            <div className="button-row">
              <button
                type="button"
                className="quiet-button"
                disabled={locked}
                onClick={() => setWeight(formatGroupedWeight(f.balance_g))}
              >
                سحب كامل المتبقي ({formatGroupedWeight(f.balance_g)} جم)
              </button>
            </div>
            <small className="field-hint">{p.withdrawalExample}</small>
            {remainingAfter !== null && !remainingAfter.startsWith('-') && (
              <p role="status">
                {p.afterWithdrawal}: <strong dir="ltr">{formatWeight(remainingAfter)}</strong>{' '}
                {p.gram}
              </p>
            )}
            {remainingAfter?.startsWith('-') && (
              <p role="status">{p.errors.INSUFFICIENT_BALANCE}</p>
            )}
            <button className="primary-button" disabled={locked}>
              {write.busy ? ui.saving : p.withdraw}
            </button>
          </form>
        </section>
      )}
      <section className="assets-panel" aria-labelledby="orders-title">
        <div className="panel-toolbar">
          <h2 id="orders-title">
            {p.orders} <span className="muted">({f.withdrawal_count})</span>
          </h2>
          <label className="orders-collapse">
            <input
              type="checkbox"
              checked={collapseCompleted}
              onChange={(e) => {
                setCollapseCompleted(e.target.checked);
                setExpandedParts({});
              }}
            />
            طي الأجزاء المكتملة
          </label>
          <button className="quiet-button" onClick={() => mutate()}>
            {p.refresh}
          </button>
        </div>
        {isLoading ? (
          <p className="empty-state">{p.loading}</p>
        ) : !data.orders.items.length ? (
          <p className="empty-state">{p.noOrders}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{p.order}</th>
                  <th>{p.quantity}</th>
                  <th>{ui.status}</th>
                  <th>{p.orderDate}</th>
                  <th>{p.ovenEquipment}</th>
                  <th>{p.ovenRemaining}</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.items.map((o) => {
                  const completed = ['stored', 'sold', 'discarded'].includes(
                    o.processing_state ?? '',
                  );
                  const expanded = expandedParts[o.id] ?? !(collapseCompleted && completed);
                  return (
                    <Fragment key={o.id}>
                      <tr className="order-separator">
                        <td colSpan={6}>
                          <div>
                            <strong>
                              جزء الإنتاج{' '}
                              <bdi>
                                {batchCode(f.code)} / {String(o.sequence_no).padStart(2, '0')}
                              </bdi>
                            </strong>
                            <span>
                              {completed
                                ? 'مكتمل'
                                : o.processing_state === 'finished'
                                  ? 'جاهز للتصريف'
                                  : 'قيد المتابعة'}
                            </span>
                          </div>
                        </td>
                      </tr>
                      <tr
                        className={
                          o.stage_status !== 'queued' ? 'processing-summary-row' : undefined
                        }
                      >
                        <td className="order-identity">
                          <bdi>
                            {batchCode(f.code)} / {String(o.sequence_no).padStart(2, '0')}
                          </bdi>
                          {(o.stage_status === 'running' ||
                            o.stage_status === 'paused' ||
                            o.stage_status === 'completed') && (
                            <button
                              type="button"
                              className="quiet-button part-toggle"
                              aria-expanded={expanded}
                              aria-controls={'part-details-' + o.id}
                              aria-label={`${expanded ? 'طي' : 'عرض'} تفاصيل الجزء ${String(o.sequence_no).padStart(2, '0')}`}
                              onClick={() =>
                                setExpandedParts((prev) => ({ ...prev, [o.id]: !expanded }))
                              }
                            >
                              {expanded ? 'طي التفاصيل' : 'عرض التفاصيل'}
                            </button>
                          )}
                          {o.stage_status === 'queued' && (
                            <button
                              className="primary-button"
                              disabled={locked}
                              onClick={() => {
                                write.setError('');
                                setOvenOrder(o);
                              }}
                            >
                              {p.startOven}
                            </button>
                          )}
                        </td>
                        <td>
                          <strong dir="ltr">{formatWeight(o.quantity_g)}</strong> {p.gram}
                        </td>
                        <td>
                          <span
                            className={`status-pill ${o.stage_status === 'running' ? 'active' : 'inactive'}`}
                          >
                            {o.processing_state
                              ? processingLabels[o.processing_state]
                              : o.stage_status === 'paused'
                                ? 'متوقف مؤقتًا'
                                : o.stage_status === 'queued'
                                  ? p.queued
                                  : o.due_at && now > Date.parse(o.due_at) + o.grace_minutes * 60000
                                    ? p.ovenLate
                                    : o.due_at && now >= Date.parse(o.due_at)
                                      ? p.ovenDue
                                      : p.ovenRunning}
                          </span>
                        </td>
                        <td>
                          <time dateTime={o.created_at}>{localDate(o.created_at, f.timezone)}</time>
                        </td>
                        <td className="order-timing">
                          {o.asset_name ?? '—'}
                          {o.started_at && (
                            <small>
                              {p.ovenStarted}: {localDate(o.started_at, f.timezone)}
                            </small>
                          )}
                        </td>
                        <td className="order-timing">
                          {o.due_at && o.stage_status !== 'completed' ? (
                            <>
                              <strong dir="ltr" role="timer" aria-live="off">
                                {duration(
                                  Math.max(
                                    0,
                                    Date.parse(o.due_at) -
                                      (o.paused_at && o.time_basis === 'active'
                                        ? Date.parse(o.paused_at)
                                        : now),
                                  ),
                                )}
                              </strong>
                              {o.started_at && (
                                <StageProgress
                                  start={Date.parse(o.started_at)}
                                  due={Date.parse(o.due_at)}
                                  now={
                                    o.paused_at && o.time_basis === 'active'
                                      ? Date.parse(o.paused_at)
                                      : now
                                  }
                                  paused={o.stage_status === 'paused'}
                                  kind="oven"
                                  compact
                                />
                              )}
                              <small>
                                {p.ovenDueAt}: {localDate(o.due_at, f.timezone)}
                              </small>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                      {expanded &&
                        (o.stage_status === 'running' ||
                          o.stage_status === 'paused' ||
                          o.stage_status === 'completed') && (
                          <tr className="processing-detail-row" id={'part-details-' + o.id}>
                            <td colSpan={6} className="processing-panel-cell">
                              <OrderProcessing
                                key={o.processing_state ?? o.stage_status}
                                order={o}
                                now={now}
                                write={write}
                                batchNumber={batchCode(f.code)}
                                productName={f.product_name}
                              />
                            </td>
                          </tr>
                        )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <Pagination cursor={cursor} next={data.orders.next_cursor} onChange={setCursor} />
        </div>
      </section>
      {ovenOrder && (
        <OvenStartForm
          order={ovenOrder}
          productName={f.product_name}
          orderCode={`${batchCode(f.code)} / ${String(ovenOrder.sequence_no).padStart(2, '0')}`}
          write={write}
          onClose={() => setOvenOrder(null)}
        />
      )}
    </>
  );
}
