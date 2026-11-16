'use client';
import type { Fermentation, ProductionOrder } from '@/contracts/fermentation';
import { formatWeight } from '@/contracts/weight';
import { GitBranch, ChevronDown } from 'lucide-react';
import { ProductionFlow } from './production-flow';
import { processingLabels } from './order-processing';
import { batchCode } from './shared';
function done(order: ProductionOrder) {
  return ['stored', 'sold', 'discarded'].includes(order.processing_state ?? '');
}
export function ProductionPaths(props: {
  batch: Fermentation;
  orders: ProductionOrder[];
  now: number;
  locked: boolean;
  onStartOven: (order: ProductionOrder) => void;
  onOpenOrder: (id: string) => void;
}) {
  if (!props.orders.length) return <ProductionFlow {...props} />;
  const sorted = [...props.orders].sort(
    (a, b) => Number(done(a)) - Number(done(b)) || b.sequence_no - a.sequence_no,
  );
  return (
    <div className="production-paths" aria-label="مسارات أجزاء الإنتاج">
      {sorted.map((order) => {
        const completed = done(order),
          part = String(order.sequence_no).padStart(2, '0');
        const status = order.processing_state
          ? processingLabels[order.processing_state]
          : order.stage_status === 'paused'
            ? 'الفرن متوقف مؤقتًا'
            : order.stage_status === 'running'
              ? order.due_at && props.now >= Date.parse(order.due_at)
                ? 'الفرن بانتظار الفحص'
                : 'الفرن قيد التشغيل'
              : 'بانتظار بدء الفرن';
        return (
          <div key={order.id} role="group" aria-label={`مسار الجزء ${part}`}>
            <details
              className={`production-path ${completed ? 'completed' : 'active'}`}
              open={!completed}
            >
              <summary>
                <span className="path-identity">
                  <GitBranch size={20} aria-hidden="true" />
                  <strong>
                    مسار الجزء{' '}
                    <bdi>
                      {batchCode(props.batch.code)} / {part}
                    </bdi>
                  </strong>
                </span>
                <span className="path-quantity">
                  المسحوب <bdi>{formatWeight(order.quantity_g)} جم</bdi>
                </span>
                {completed && order.packing_output_g !== null && (
                  <span className="path-quantity">
                    الناتج <bdi>{formatWeight(order.packing_output_g)} جم</bdi>
                  </span>
                )}
                <span className={`status-pill ${completed ? 'active' : 'inactive'}`}>{status}</span>
                <ChevronDown size={18} className="path-chevron" aria-hidden="true" />
              </summary>
              <ProductionFlow {...props} orders={[order]} />
            </details>
          </div>
        );
      })}
    </div>
  );
}
