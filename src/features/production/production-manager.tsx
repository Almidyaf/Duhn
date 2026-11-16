'use client';
import { formatWeight } from '@/contracts/weight';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Plus, Search, Flame, X } from 'lucide-react';
import type { Cursor } from '@/contracts/catalog';
import type { ProductionOrderItem, ProductionPage } from '@/contracts/production';
import { productionUi as p } from '@/locales/ar/production';
import { ui } from '@/locales/ar/ui';
import { workflowUi as w } from '@/locales/ar/workflow';
import { KgBadge } from '@/components/weight-hint';
import { fetchJson, Pagination, WriteFeedback } from '../catalog/shared';
import { useProductionWrite } from './use-production-write';
import { StartForm } from './start-form';
import { processingLabels } from './order-processing';
import { localDate, useServerClock, duration } from './shared';

function orderCode(code: string) {
  return `PRD-${code.padStart(6, '0')}`;
}

function orderStatusLabel(o: ProductionOrderItem, now: number) {
  if (o.processing_state) return processingLabels[o.processing_state];
  if (o.stage_status === 'queued') return 'بانتظار الفرن';
  if (o.stage_status === 'paused') return 'الفرن متوقف مؤقتًا';
  if (o.due_at && now >= Date.parse(o.due_at)) return 'بانتظار الفحص';
  return 'في الفرن';
}

function orderStatusClass(o: ProductionOrderItem, now: number) {
  if (o.processing_state === 'discarded') return 'status-pill inactive';
  if (o.processing_state === 'stored' || o.processing_state === 'sold') return 'status-pill active';
  if (o.stage_status === 'paused') return 'status-pill warning';
  if (o.stage_status === 'running' && o.due_at && now >= Date.parse(o.due_at))
    return 'status-pill late';
  return 'status-pill';
}

export function ProductionManager({
  initial,
  userId,
}: {
  initial: ProductionPage;
  userId: string;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'queued' | 'running' | 'finished' | 'completed'
  >('all');
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const params = new URLSearchParams({ q: search });
  if (cursor) {
    params.set('before_at', cursor.at);
    params.set('before_id', cursor.id);
  }
  const url = `/api/v1/production-orders?${params}`;
  const { data, error, isLoading, mutate } = useSWR<ProductionPage>(url, fetchJson, {
    fallbackData: url === '/api/v1/production-orders?q=' ? initial : undefined,
    refreshInterval: 0,
  });

  const now = useServerClock(data?.server_time ?? initial.server_time);

  const filteredItems = (data?.items ?? []).filter((o) => {
    const done = ['stored', 'sold', 'discarded'].includes(o.processing_state ?? '');
    if (statusFilter === 'all') return true;
    if (statusFilter === 'queued') return !o.processing_state && o.stage_status === 'queued';
    if (statusFilter === 'running')
      return (
        (!o.processing_state && o.stage_status !== 'queued') ||
        ['filter_queued', 'filter_running', 'packing_queued', 'packing_running'].includes(
          o.processing_state ?? '',
        )
      );
    if (statusFilter === 'finished') return o.processing_state === 'finished';
    return done;
  });

  const write = useProductionWrite(userId, async () => {
    setOpen(false);
    await mutate();
  });

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query);
      setCursor(null);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{ui.production}</p>
          <h1>خط الإنتاج</h1>
          <p className="muted">من المادة الخام مباشرة إلى الفرن ثم التصفية والتعبئة والمخزون.</p>
        </div>
        <button
          className="primary-button"
          disabled={write.locked}
          onClick={() => {
            write.setError('');
            setOpen(true);
          }}
        >
          <Plus size={18} />
          بدء إنتاج جديد
        </button>
      </div>
      {!open && <WriteFeedback write={write} />}

      <section className="assets-panel" aria-label="خط الإنتاج">
        <div className="panel-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label="ابحث باسم الدهن أو العود أو رقم الطلب"
              placeholder="ابحث باسم الدهن أو العود أو رقم الطلب"
              value={query}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="quiet-button" onClick={() => mutate()}>
            {p.refresh}
          </button>
        </div>
        <div className="button-row" role="group" aria-label="تصفية حسب الحالة">
          {(
            [
              ['all', 'الكل'],
              ['queued', 'بانتظار الفرن'],
              ['running', 'قيد التشغيل'],
              ['finished', 'جاهز للتصريف'],
              ['completed', 'مكتمل'],
            ] as const
          ).map(([key, text]) => (
            <button
              key={key}
              type="button"
              className={statusFilter === key ? 'secondary-button' : 'quiet-button'}
              aria-pressed={statusFilter === key}
              onClick={() => setStatusFilter(key)}
            >
              {text}
            </button>
          ))}
        </div>

        {error ? (
          <div className="empty-state" role="alert">
            {p.loadError}
          </div>
        ) : isLoading && !data ? (
          <p className="empty-state" role="status">
            {p.loading}
          </p>
        ) : !filteredItems.length ? (
          <div className="empty-state">
            <Flame size={36} />
            <h2>{search || statusFilter !== 'all' ? p.empty : w.setupTitle}</h2>
            {!search && statusFilter === 'all' && (
              <>
                <p className="muted">{w.setupLead}</p>
                <div className="setup-steps">
                  <Link href="/settings">{w.setupSettings}</Link>
                  <Link href="/purchases/catalog?view=finished">{w.setupCatalog}</Link>
                  <Link href="/purchases">{w.setupStock}</Link>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{p.order}</th>
                    <th>الدهن / العود</th>
                    <th>{p.quantity}</th>
                    <th>{ui.status}</th>
                    <th>{p.ovenEquipment}</th>
                    <th>{p.due}</th>
                    <th>{ui.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <strong dir="ltr">{orderCode(o.code)}</strong>
                      </td>
                      <td>
                        <strong>{o.product_name}</strong>
                        <small className="cell-subtitle">{o.raw_product_name}</small>
                      </td>
                      <td>
                        <strong dir="ltr">{formatWeight(o.quantity_g)}</strong> {p.gram}
                        <KgBadge value={o.quantity_g} />
                      </td>
                      <td>
                        <span className={orderStatusClass(o, now)}>
                          {orderStatusLabel(o, now)}
                        </span>
                      </td>
                      <td>{o.asset_name ?? '—'}</td>
                      <td>
                        {o.due_at ? (
                          <>
                            <time dateTime={o.due_at}>{localDate(o.due_at, o.timezone)}</time>
                            <small className="cell-subtitle">
                              {o.stage_status === 'running'
                                ? duration(Date.parse(o.due_at) - now)
                                : ''}
                            </small>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <Link className="quiet-button" href={`/production/${o.id}`}>
                          {p.details}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <Pagination cursor={cursor} next={data?.next_cursor ?? null} onChange={setCursor} />
            </div>
          </>
        )}
      </section>

      <dialog
        ref={dialog}
        className="asset-dialog recipe-dialog wizard-dialog"
        aria-labelledby="start-title"
        onCancel={(e) => {
          if (write.busy) e.preventDefault();
          else setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-heading">
          <h2 id="start-title">بدء إنتاج جديد</h2>
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
        {open && <StartForm write={write} onClose={() => setOpen(false)} />}
      </dialog>
    </>
  );
}
