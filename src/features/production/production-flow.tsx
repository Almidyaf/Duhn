'use client';
import { formatWeight } from '@/contracts/weight';
import { useId, useState } from 'react';
import { AnimatedFlame } from './animated-flame';
import { StageProgress, timeProgress } from './stage-progress';
import {
  FlaskConical,
  ArrowLeftRight,
  Flame,
  Filter,
  PackageCheck,
  ChevronLeft,
  Check,
  Clock3,
} from 'lucide-react';
import type { Fermentation, ProductionOrder } from '@/contracts/fermentation';
import { duration, localDate } from './shared';
const stages = [
  { key: 'fermentation', label: 'التخمير', Icon: FlaskConical },
  { key: 'withdrawal', label: 'السحب للإنتاج', Icon: ArrowLeftRight },
  { key: 'oven', label: 'الفرن', Icon: Flame },
  { key: 'filter', label: 'التصفية', Icon: Filter },
  { key: 'packing', label: 'التعبئة', Icon: PackageCheck },
] as const;
type Stage = (typeof stages)[number]['key'];
export function ProductionFlow({
  batch,
  orders,
  now,
  locked,
  onStartOven,
  onOpenOrder,
}: {
  batch: Fermentation;
  orders: ProductionOrder[];
  now: number;
  locked: boolean;
  onStartOven: (order: ProductionOrder) => void;
  onOpenOrder: (id: string) => void;
}) {
  const flowId = useId();
  const detailId = useId();
  const [orderId, setOrderId] = useState(orders[0]?.id ?? '');
  const order = orders.find((o) => o.id === orderId) ?? orders[0];
  const [selected, setSelected] = useState<Stage>(orders.length ? 'oven' : 'fermentation');
  const state = order?.processing_state;
  const filterDone = order?.filter_output_g != null,
    packingDone = order?.packing_output_g != null;
  const current: Stage =
    state === 'discarded'
      ? packingDone
        ? 'packing'
        : filterDone
          ? 'filter'
          : 'oven'
      : state?.startsWith('filter')
        ? 'filter'
        : state
          ? 'packing'
          : order
            ? 'oven'
            : 'fermentation';
  const ovenNow =
    order?.paused_at && order.time_basis === 'active' ? Date.parse(order.paused_at) : now;
  const due = order?.due_at ? Date.parse(order.due_at) : 0;
  const ovenStatus =
    order?.stage_status === 'paused'
      ? 'متوقف مؤقتًا'
      : order?.stage_status === 'running'
        ? now >= due
          ? now > due + order.grace_minutes * 60000
            ? 'متأخر عن الفحص'
            : 'جاهز للفحص'
          : 'قيد التشغيل'
        : order?.stage_status === 'completed'
          ? 'مكتمل'
          : 'بانتظار البدء';
  const fermentStatus =
    batch.status === 'fermenting'
      ? now >= Date.parse(batch.due_at)
        ? 'جاهز للفحص'
        : 'قيد التخمير'
      : batch.status === 'depleted'
        ? 'سُحب الرصيد كاملًا'
        : 'متاح للسحب · تخمير مستمر';
  const statuses = {
    fermentation: fermentStatus,
    withdrawal: order ? 'تم السحب' : 'بانتظار السحب',
    oven: order ? ovenStatus : 'بانتظار السحب',
    filter: filterDone
      ? 'مكتملة'
      : state === 'filter_running'
        ? 'قيد التصفية'
        : state === 'filter_queued'
          ? 'جاهزة للبدء'
          : 'بانتظار اكتمال الفرن',
    packing: packingDone
      ? state === 'stored'
        ? 'في المخزون'
        : state === 'sold'
          ? 'تم البيع'
          : 'مكتملة'
      : state === 'packing_running'
        ? 'قيد التعبئة'
        : state === 'packing_queued'
          ? 'جاهزة للبدء'
          : 'بانتظار التصفية',
  };
  const timed =
    selected === 'fermentation'
      ? {
          start: Date.parse(batch.started_at),
          due: Date.parse(batch.due_at),
          running: batch.status === 'fermenting',
        }
      : selected === 'oven' &&
          order?.stage_status !== 'completed' &&
          order?.started_at &&
          order.due_at
        ? { start: Date.parse(order.started_at), due: Date.parse(order.due_at), running: true }
        : null;
  const jump = () => {
    const id =
      selected === 'fermentation'
        ? 'inspection-title'
        : selected === 'withdrawal'
          ? 'withdraw-title'
          : 'orders-title';
    const node = document.getElementById(id);
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  return (
    <section className="flow-panel" aria-labelledby={flowId}>
      <div className="flow-heading">
        <div>
          <h2 id={flowId}>مسار الإنتاج</h2>
          <span className="flow-legend">
            <i /> المرحلة الحالية
          </span>
        </div>
        {order && orders.length > 1 && (
          <label className="flow-selector">
            جزء الإنتاج
            <select
              aria-label="عرض مسار جزء الإنتاج"
              value={order.id}
              onChange={(e) => {
                setOrderId(e.target.value);
                setSelected('oven');
              }}
            >
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  جزء {String(o.sequence_no).padStart(2, '0')} · {formatWeight(o.quantity_g)} جم
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flow-track" role="group" aria-label="مراحل الإنتاج">
        {stages.map(({ key, label, Icon }, i) => (
          <div className="flow-stop" key={key}>
            <button
              type="button"
              className={`flow-node ${selected === key ? 'selected' : ''} ${current === key ? 'current' : ''} ${(key === 'withdrawal' && order) || (key === 'oven' && order?.stage_status === 'completed') || (key === 'filter' && filterDone) || (key === 'packing' && packingDone) ? 'done' : ''}`}
              aria-pressed={selected === key}
              aria-controls={detailId}
              aria-current={current === key ? 'step' : undefined}
              onClick={() => setSelected(key)}
            >
              <span
                className={`flow-icon stage-card-icon ${key} ${(key === 'fermentation' && batch.status !== 'depleted') || (key === 'oven' && order?.stage_status === 'running' && due > now) || (key === 'filter' && state === 'filter_running') || (key === 'packing' && state === 'packing_running') ? 'animating' : ''}`}
              >
                {key === 'oven' ? (
                  <AnimatedFlame
                    active={order?.stage_status === 'running' && due > now}
                    size={34}
                  />
                ) : (
                  <Icon size={25} aria-hidden="true" />
                )}
                {key === 'withdrawal' && order && <Check className="flow-check" size={13} />}
              </span>
              <strong>{label}</strong>
              <small>{statuses[key]}</small>
              <bdi>
                {key === 'fermentation'
                  ? formatWeight(order?.quantity_g ?? batch.balance_g) + ' جم'
                  : key === 'oven' && order?.oven_output_g != null
                    ? formatWeight(order.oven_output_g) + ' جم'
                    : key === 'withdrawal' || key === 'oven'
                      ? order
                        ? formatWeight(order.quantity_g) + ' جم'
                        : '—'
                      : key === 'filter' && order?.filter_output_g != null
                        ? formatWeight(order.filter_output_g) + ' جم'
                        : key === 'packing' && order?.packing_output_g != null
                          ? formatWeight(order.packing_output_g) + ' جم'
                          : '—'}
              </bdi>
              <span
                className={`stage-card-progress ${(key === 'filter' && state === 'filter_running') || (key === 'packing' && state === 'packing_running') ? 'indeterminate' : ''}`}
                aria-hidden="true"
              >
                <span
                  style={{
                    width: `${(key === 'filter' && filterDone) || (key === 'packing' && packingDone) ? 100 : key === 'withdrawal' && order ? 100 : key === 'fermentation' ? timeProgress(Date.parse(batch.started_at), Date.parse(batch.due_at), now).elapsed : key === 'oven' && order?.started_at && due ? timeProgress(Date.parse(order.started_at), due, ovenNow).elapsed : 0}%`,
                  }}
                />
              </span>
              <span className="stage-card-percent">
                {(key === 'oven' && order?.stage_status === 'completed') ||
                (key === 'filter' && filterDone) ||
                (key === 'packing' && packingDone)
                  ? 'اكتملت 100%'
                  : (key === 'filter' && state === 'filter_running') ||
                      (key === 'packing' && state === 'packing_running')
                    ? 'قيد التنفيذ'
                    : key === 'fermentation'
                      ? `تقدم المدة ${Math.floor(timeProgress(Date.parse(batch.started_at), Date.parse(batch.due_at), now).elapsed)}%`
                      : key === 'oven' && order?.started_at && due
                        ? `تقدم المدة ${Math.floor(timeProgress(Date.parse(order.started_at), due, ovenNow).elapsed)}%`
                        : key === 'withdrawal' && order
                          ? 'تم السحب 100%'
                          : 'بانتظار البدء'}
              </span>
            </button>
            {i < stages.length - 1 && (
              <ChevronLeft className="flow-arrow" size={18} aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
      <div className="flow-details" id={detailId} role="region" aria-label="تفاصيل المرحلة">
        <div className="flow-detail-heading">
          <strong>{stages.find((s) => s.key === selected)?.label}</strong>
          <span className="status-pill active">{statuses[selected]}</span>
        </div>
        {selected === 'fermentation' && (
          <div className="flow-facts">
            <span>
              المتبقي في التخمير <bdi>{formatWeight(batch.balance_g)} جم</bdi>
            </span>
            <span>
              بداية الدفعة <bdi>{localDate(batch.started_at, batch.timezone)}</bdi>
            </span>
          </div>
        )}
        {selected === 'withdrawal' && order && (
          <div className="flow-facts">
            <span>
              الكمية المسحوبة <bdi>{formatWeight(order.quantity_g)} جم</bdi>
            </span>
            <span>
              تاريخ السحب <bdi>{localDate(order.created_at, batch.timezone)}</bdi>
            </span>
          </div>
        )}
        {selected === 'oven' && order && (
          <div className="flow-facts">
            <span>
              الكمية <bdi>{formatWeight(order.quantity_g)} جم</bdi>
            </span>
            <span>
              الفرن <strong>{order.asset_name ?? 'لم يُحدد بعد'}</strong>
            </span>
          </div>
        )}
        {selected === 'filter' && order && (
          <div className="flow-facts">
            <span>
              الكمية الداخلة <bdi>{formatWeight(order.oven_output_g ?? '—')} جم</bdi>
            </span>
            <span>
              الناتج <bdi>{formatWeight(order.filter_output_g ?? 'لم يسجل')}</bdi>
            </span>
          </div>
        )}
        {selected === 'packing' && order && (
          <div className="flow-facts">
            <span>
              الكمية الداخلة <bdi>{formatWeight(order.filter_output_g ?? '—')} جم</bdi>
            </span>
            <span>
              الناتج <bdi>{formatWeight(order.packing_output_g ?? 'لم يسجل')}</bdi>
            </span>
          </div>
        )}
        {timed && (
          <div className="flow-timing">
            <div className="flow-time">
              <Clock3 size={18} />
              <span>{now >= timed.due ? 'انتهت مدة الفحص' : 'حتى موعد الفحص'}</span>
              <strong dir="ltr">
                {duration(Math.max(0, timed.due - (selected === 'oven' ? ovenNow : now)))}
              </strong>
            </div>
            <StageProgress
              start={timed.start}
              due={timed.due}
              now={selected === 'oven' ? ovenNow : now}
              paused={selected === 'oven' && order?.stage_status === 'paused'}
              kind={selected === 'oven' ? 'oven' : 'fermentation'}
            />
            <small>
              موعد الفحص: {localDate(new Date(timed.due).toISOString(), batch.timezone)}
            </small>
          </div>
        )}
        <div className="button-row">
          {order && state && (
            <button type="button" className="primary-button" onClick={() => onOpenOrder(order.id)}>
              متابعة {current === 'filter' ? 'التصفية' : 'التعبئة والمنتج النهائي'}
            </button>
          )}
          {selected === 'oven' && order?.stage_status === 'queued' && (
            <button
              type="button"
              className="primary-button"
              disabled={locked}
              onClick={() => onStartOven(order)}
            >
              <Flame size={17} /> بدء الفرن لهذا الجزء
            </button>
          )}
          {selected === 'fermentation' && batch.status === 'fermenting' && (
            <button type="button" className="secondary-button" onClick={jump}>
              فحص التخمير
            </button>
          )}
          {(selected === 'fermentation' || selected === 'withdrawal') &&
            batch.status === 'ready' && (
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  document
                    .getElementById('withdraw-title')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              >
                سحب كمية للإنتاج
              </button>
            )}
        </div>
      </div>
    </section>
  );
}
