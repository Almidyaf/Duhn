'use client';
import { formatWeight } from '@/contracts/weight';
import { useEffect, useState } from 'react';
import { Filter, PackageCheck, Flame, GitBranch } from 'lucide-react';
import type { ProductionOrder } from '@/contracts/fermentation';
import type { ProcessingInput, ProcessingState } from '@/contracts/processing';
import { normalizeWeightInput, toMilligrams, fromMilligrams } from '@/contracts/weight';
import {
  formatGroupedWeight,
  formatLiveWeightInput,
  parseGroupedWeightInput,
  WeightHint,
} from '@/components/weight-hint';
import { CopyCodeButton } from '@/components/copy-code-button';
import type { useProductionWrite } from './use-production-write';
export const processingLabels: Record<ProcessingState, string> = {
  filter_queued: 'بانتظار التصفية',
  filter_running: 'قيد التصفية',
  packing_queued: 'بانتظار التعبئة',
  packing_running: 'قيد التعبئة',
  finished: 'منتج معبأ جاهز',
  stored: 'نُقل إلى المخزون',
  sold: 'تم البيع اللحظي',
  discarded: 'لا يوجد ناتج صالح',
};
export const pauseReasons = [
  'انقطاع الكهرباء',
  'تعطل الماطور',
  'تقلّب درجة الحرارة',
  'نقص المياه / التبريد',
  'صيانة / تنظيف',
  'نهاية الدوام',
] as const;

export function OrderProcessing({
  order: o,
  now,
  write,
  batchNumber,
  productName,
}: {
  order: ProductionOrder;
  now: number;
  write: ReturnType<typeof useProductionWrite>;
  batchNumber: string;
  productName: string;
}) {
  const [weight, setWeight] = useState(() =>
      o.processing_state === 'packing_running' && o.available_g
        ? formatGroupedWeight(o.available_g)
        : '',
    ),
    [destination, setDestination] = useState<'store' | 'sell' | null>(null),
    [pauseReason, setPauseReason] = useState('');
  useEffect(() => {
    setWeight(
      o.processing_state === 'packing_running' && o.available_g
        ? formatGroupedWeight(o.available_g)
        : '',
    );
    if (o.processing_state !== 'finished') setDestination(null);
  }, [o.processing_state, o.available_g]);
  const state = o.processing_state;
  const version = state ? o.processing_version! : o.stage_version;
  const amount = state ? o.available_g! : o.quantity_g;
  const yieldHundredths =
    o.packing_output_g !== null
      ? (toMilligrams(o.packing_output_g) * 10000n) / toMilligrams(o.quantity_g)
      : null;
  const part = String(o.sequence_no).padStart(2, '0');
  const phase = state?.startsWith('filter')
    ? 'التصفية'
    : state?.startsWith('packing')
      ? 'التعبئة'
      : state
        ? 'المنتج النهائي'
        : 'الفرن';
  const PhaseIcon = phase === 'التصفية' ? Filter : phase === 'الفرن' ? Flame : PackageCheck;
  const completing = !state
    ? 'complete_oven'
    : state === 'filter_running'
      ? 'complete_filter'
      : state === 'packing_running'
        ? 'complete_packing'
        : null;
  const label = !state
    ? 'إنهاء الفرن وتسجيل الناتج'
    : state === 'filter_running'
      ? 'إنهاء التصفية'
      : state === 'packing_running'
        ? 'إنهاء التعبئة'
        : state
          ? processingLabels[state]
          : '';
  const ready = state || (!!o.due_at && now >= Date.parse(o.due_at));
  async function send(action: ProcessingInput['action'], extra: Partial<ProcessingInput> = {}) {
    await write.submit(`/api/v1/production-orders/${o.id}/process`, 'POST', {
      action,
      expected_version: version,
      ...extra,
    });
  }
  let difference: string | null = null;
  let isZeroOutput = false;
  try {
    if (weight.trim()) {
      const normalized = parseGroupedWeightInput(weight);
      isZeroOutput = toMilligrams(normalized) === 0n;
      difference = fromMilligrams(toMilligrams(amount) - toMilligrams(normalized));
    }
  } catch {}
  return (
    <section
      id={'processing-' + o.id}
      className="order-processing"
      aria-label={`إجراءات جزء ${o.sequence_no}`}
      aria-describedby={'processing-context-' + o.id}
    >
      <header className="processing-context" id={'processing-context-' + o.id}>
        <div className="processing-context-title">
          <span className="processing-phase-icon">
            <PhaseIcon size={24} aria-hidden="true" />
          </span>
          <div>
            <h3>
              {phase} · الجزء {part}
            </h3>
            <strong>{productName}</strong>
          </div>
        </div>
        <div className="processing-lineage">
          <span>
            <GitBranch size={15} aria-hidden="true" /> الدفعة <bdi>{batchNumber}</bdi>
          </span>
          <span>
            جزء الإنتاج{' '}
            <bdi>
              {batchNumber} / {part}
            </bdi>{' '}
            <CopyCodeButton code={`${batchNumber} / ${part}`} label="نسخ رقم الجزء" />
          </span>
        </div>
        <div className="processing-input">
          <span>
            {state === 'finished' || state === 'stored' || state === 'sold'
              ? 'الكمية النهائية'
              : 'الكمية الداخلة إلى ' + phase}
          </span>
          <strong>
            <bdi>
              {formatWeight(state === 'stored' || state === 'sold' ? o.packing_output_g : amount)}
            </bdi>{' '}
            جم
          </strong>
        </div>
      </header>
      {!state && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (write.locked) return;
            const form = new FormData(e.currentTarget);
            await send(o.stage_status === 'paused' ? 'resume_oven' : 'pause_oven', {
              note: String(form.get('reason') ?? ''),
              ...(o.stage_status === 'paused' ? { inspection_confirmed: true } : {}),
            });
          }}
        >
          {o.stage_status === 'paused' ? (
            <label className="checkbox-label">
              <input type="checkbox" required />
              فحصت العملية وأؤكد جاهزيتها للاستئناف
            </label>
          ) : (
            <>
              <div className="button-row" role="group" aria-label="أسباب التوقف الشائعة">
                {pauseReasons.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    className={pauseReason === reason ? 'secondary-button' : 'quiet-button'}
                    disabled={write.locked}
                    onClick={() => setPauseReason(reason)}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <label>
                سبب التوقف
                <input
                  name="reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  value={pauseReason}
                  placeholder="اختر سببًا من الأعلى أو اكتب سببًا آخر…"
                  onChange={(e) => setPauseReason(e.target.value)}
                />
              </label>
            </>
          )}
          <button className="secondary-button" disabled={write.locked}>
            {o.stage_status === 'paused' ? 'استئناف الفرن' : 'إيقاف مؤقت للفرن'}
          </button>
        </form>
      )}
      <div className="processing-results">
        {o.packing_output_g !== null && (
          <span>
            نسبة الناتج{' '}
            <bdi>
              {yieldHundredths !== null
                ? formatWeight(
                    `${yieldHundredths / 100n}.${String(yieldHundredths % 100n).padStart(2, '0')}`,
                  )
                : '—'}
              %
            </bdi>
          </span>
        )}
        {o.oven_output_g !== null && (
          <span>
            بعد الفرن <bdi>{formatWeight(o.oven_output_g)} جم</bdi>
          </span>
        )}
        {o.filter_output_g !== null && (
          <span>
            بعد التصفية <bdi>{formatWeight(o.filter_output_g)} جم</bdi>
          </span>
        )}
        {o.packing_output_g !== null && (
          <span>
            بعد التعبئة <bdi>{formatWeight(o.packing_output_g)} جم</bdi>
          </span>
        )}
      </div>
      {completing && ready && o.stage_status !== 'paused' && (
        <form
          key={completing}
          onSubmit={async (e) => {
            e.preventDefault();
            if (write.locked) return;
            const form = new FormData(e.currentTarget);
            try {
              await send(completing, {
                quantity_g: parseGroupedWeightInput(weight),
                inspection_confirmed: true,
                note: String(form.get('note') ?? ''),
              });
            } catch {
              write.setError('تحقق من الوزن الناتج.');
            }
          }}
        >
          <h3>{label}</h3>
          <div className="processing-fields">
            <label>
              الوزن الناتج بالجرام
              <input
                aria-label="الوزن الناتج بالجرام"
                required
                dir="ltr"
                inputMode="decimal"
                maxLength={25}
                value={weight}
                onChange={(e) => setWeight(formatLiveWeightInput(e.target.value))}
                disabled={write.locked}
              />
              <WeightHint value={weight} />
            </label>
            <label>
              ملاحظة أو سبب عدم وجود ناتج
              <input
                name="note"
                required={isZeroOutput}
                minLength={isZeroOutput ? 3 : undefined}
                maxLength={1000}
                disabled={write.locked}
              />
              {isZeroOutput && (
                <small className="field-hint">
                  تسجيل 0 جم يتطلب كتابة سبب وسيغلق هذا الجزء نهائيًا بلا مخزون.
                </small>
              )}
            </label>
          </div>
          {difference !== null && difference.startsWith('-') && (
            <p className="notice danger" role="alert">
              الوزن الناتج أكبر من الكمية الداخلة ({formatWeight(amount)} جم).
            </p>
          )}
          {difference !== null && !difference.startsWith('-') && (
            <p>
              فرق الوزن <bdi>{formatWeight(difference)} جم</bdi>
            </p>
          )}
          <label className="checkbox-label">
            <input type="checkbox" required disabled={write.locked} />
            {!state ? 'فحصت الناتج وأخرجته من الفرن' : 'فحصت الناتج وأؤكد الوزن المسجل'}
          </label>
          <button className="primary-button" disabled={write.locked || difference?.startsWith('-')}>
            {label}
          </button>
        </form>
      )}
      {(state === 'filter_queued' || state === 'packing_queued') && (
        <button
          className="primary-button"
          disabled={write.locked}
          onClick={() => send(state === 'filter_queued' ? 'start_filter' : 'start_packing')}
        >
          {state === 'filter_queued' ? 'بدء التصفية' : 'بدء التعبئة'}
        </button>
      )}
      {state === 'finished' && (
        <>
          <h3>
            اكتمل الإنتاج · <bdi>{formatWeight(o.packing_output_g)} جم</bdi>
          </h3>
          <div className="button-row">
            {!destination ? (
              <>
                <button
                  className="primary-button"
                  disabled={write.locked}
                  onClick={() => setDestination('store')}
                >
                  نقل إلى المخزون
                </button>
                <button
                  className="secondary-button"
                  disabled={write.locked}
                  onClick={() => setDestination('sell')}
                >
                  بيع لحظي
                </button>
              </>
            ) : (
              <>
                <strong>
                  {destination === 'store' ? 'نقل كامل الكمية إلى المخزون' : 'بيع كامل الكمية'}:{' '}
                  <bdi>{formatWeight(amount)} جم</bdi>
                </strong>
                <button
                  className="primary-button"
                  disabled={write.locked}
                  onClick={() => send(destination)}
                >
                  تأكيد {destination === 'store' ? 'النقل' : 'البيع'}
                </button>
                <button
                  className="quiet-button"
                  disabled={write.locked}
                  onClick={() => setDestination(null)}
                >
                  إلغاء
                </button>
              </>
            )}
          </div>
        </>
      )}
      {(state === 'stored' || state === 'sold' || state === 'discarded') && (
        <strong>{processingLabels[state]}</strong>
      )}
    </section>
  );
}
