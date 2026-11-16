'use client';
import { formatWeight } from '@/contracts/weight';
import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowRight, Flame } from 'lucide-react';
import type { ProductionDetail } from '@/contracts/production';
import { OvenStartForm } from './oven-start-form';
import { OrderProcessing, processingLabels } from './order-processing';
import { StageProgress } from './stage-progress';
import { CopyCodeButton } from '@/components/copy-code-button';
import { fetchJson, WriteFeedback } from '../catalog/shared';
import { useProductionWrite } from './use-production-write';
import { localDate, useServerClock, duration } from './shared';
import { productionUi as p } from '@/locales/ar/production';

export function ProductionOrderDetailView({
  initial,
  userId,
}: {
  initial: ProductionDetail;
  userId: string;
}) {
  const [ovenOpen, setOvenOpen] = useState(false);
  const url = `/api/v1/production-orders/${initial.order.id}`;
  const {
    data = initial,
    error,
    isLoading,
    mutate,
  } = useSWR<ProductionDetail>(url, fetchJson, {
    fallbackData: initial,
    refreshInterval: 30000,
  });

  const o = data.order;
  const now = useServerClock(data.server_time);
  const code = `PRD-${o.code.padStart(6, '0')}`;

  const write = useProductionWrite(userId, async () => {
    setOvenOpen(false);
    await mutate();
  });

  const locked = write.locked || !!error || isLoading;

  // Map ProductionOrderItem to ProductionOrder shape expected by OvenStartForm and OrderProcessing
  const compatOrder = {
    ...o,
    sequence_no: Number(o.code),
  };

  return (
    <>
      <Link href="/production" className="quiet-button">
        <ArrowRight size={16} />
        {p.back}
      </Link>

      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <span dir="ltr">{code}</span> · {o.raw_product_name}{' '}
            <CopyCodeButton code={code} label="نسخ رقم أمر الإنتاج" />
          </p>
          <h1>{o.product_name}</h1>
          <p className="muted">
            {p.timezone}: {o.timezone}
          </p>
        </div>
        <span className="status-pill active">
          {o.processing_state
            ? processingLabels[o.processing_state]
            : o.stage_status === 'queued'
              ? 'بانتظار الفرن'
              : o.stage_status === 'paused'
                ? 'الفرن متوقف مؤقتًا'
                : 'في الفرن'}
        </span>
      </div>

      {!ovenOpen && <WriteFeedback write={write} />}
      {error && (
        <p className="notice danger" role="alert">
          {p.loadError}
        </p>
      )}

      <div className="production-summary">
        <div>
          <small>الكمية الداخلة</small>
          <strong>
            <span dir="ltr">{formatWeight(o.quantity_g)}</span> {p.gram}
          </strong>
        </div>
        <div>
          <small>المادة الخام (العود)</small>
          <strong>{o.raw_product_name}</strong>
        </div>
        <div>
          <small>الفرن</small>
          <strong>{o.asset_name ?? 'بانتظار التخصيص'}</strong>
        </div>
        <div>
          <small>تاريخ البدء</small>
          <strong>{localDate(o.created_at, o.timezone)}</strong>
        </div>
      </div>

      {o.stage_status === 'queued' ? (
        <section className="production-action" aria-labelledby="oven-queue-title">
          <div>
            <h2 id="oven-queue-title">مرحلة الفرن</h2>
            <p className="muted">أمر الإنتاج جاهز للتشغيل. اختر الفرن والمدة لبدء المرحلة.</p>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={locked}
            onClick={() => {
              write.setError('');
              setOvenOpen(true);
            }}
          >
            <Flame size={18} />
            {p.startOven}
          </button>
        </section>
      ) : (
        <>
          {!o.processing_state && o.started_at && o.due_at && (
            <section className="assets-panel" aria-label="تقدم مرحلة الفرن">
              <div className="panel-toolbar">
                <strong>
                  الفرن: {o.asset_name} ·{' '}
                  {o.stage_status === 'paused'
                    ? 'متوقف مؤقتًا'
                    : duration(Date.parse(o.due_at) - now)}
                </strong>
              </div>
              <StageProgress
                kind="oven"
                start={Date.parse(o.started_at)}
                due={Date.parse(o.due_at)}
                now={now}
                paused={o.stage_status === 'paused'}
              />
            </section>
          )}
          <OrderProcessing
            order={compatOrder}
            now={now}
            write={write}
            batchNumber={code}
            productName={o.product_name}
          />
        </>
      )}

      {ovenOpen && (
        <OvenStartForm
          order={compatOrder}
          productName={o.product_name}
          orderCode={code}
          write={write}
          onClose={() => setOvenOpen(false)}
        />
      )}
    </>
  );
}
