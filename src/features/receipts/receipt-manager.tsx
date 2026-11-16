'use client';
import { formatWeight } from '@/contracts/weight';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Plus, X, Search, PackagePlus } from 'lucide-react';
import type { ReceiptPage } from '@/contracts/receipts';
import type { Cursor } from '@/contracts/catalog';
import { receiptUi as r } from '@/locales/ar/receipts';
import { ui } from '@/locales/ar/ui';
import { Pagination, WriteFeedback, fetchJson } from '../catalog/shared';
import { useReceiptWrite } from './use-receipt-write';
import { PurchaseNav } from './purchase-nav';
import { ReceiptForm } from './receipt-form';
import { workflowUi as w } from '@/locales/ar/workflow';
export function ReceiptManager({
  initial,
  userId,
  isOwner,
}: {
  initial: ReceiptPage;
  userId: string;
  isOwner: boolean;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'purchase' | 'opening'>('purchase');
  const dialog = useRef<HTMLDialogElement>(null);
  const params = new URLSearchParams({ q: search, status });
  if (cursor) {
    params.set('before_at', cursor.at);
    params.set('before_id', cursor.id);
  }
  const url = `/api/v1/receipts?${params}`;
  const { data, error, isLoading, mutate } = useSWR<ReceiptPage>(url, fetchJson, {
    fallbackData: url === '/api/v1/receipts?q=&status=all' ? initial : undefined,
    refreshInterval: 0,
  });
  const write = useReceiptWrite(userId, async () => {
    setOpen(false);
    await mutate();
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setCursor(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  function begin(next: 'purchase' | 'opening') {
    setKind(next);
    write.setError('');
    setOpen(true);
  }
  return (
    <>
      <PurchaseNav active="receipts" />
      <div className="page-heading">
        <div>
          <h1>{r.title}</h1>
        </div>
        <div className="button-row">
          <button
            className="primary-button"
            disabled={write.locked}
            onClick={() => begin('purchase')}
          >
            <Plus size={18} />
            {r.add}
          </button>
          {isOwner && (
            <button
              className="secondary-button"
              disabled={write.locked}
              onClick={() => begin('opening')}
            >
              {r.opening}
            </button>
          )}
        </div>
      </div>
      {!open && <WriteFeedback write={write} />}
      <section className="assets-panel" aria-label={r.receipts}>
        <div className="panel-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label={r.search}
              placeholder={r.search}
              value={query}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label={ui.status}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setCursor(null);
            }}
          >
            <option value="all">{ui.all}</option>
            <option value="posted">{r.posted}</option>
            <option value="voided">{r.voided}</option>
          </select>
        </div>
        {error ? (
          <div className="empty-state">
            <p role="alert">{r.loadError}</p>
            <button className="secondary-button" onClick={() => mutate()}>
              {ui.retry}
            </button>
          </div>
        ) : isLoading && !data ? (
          <p className="empty-state" role="status">
            {r.loading}
          </p>
        ) : !data?.items.length ? (
          <div className="empty-state">
            <PackagePlus size={36} />
            <h2>{query ? r.noResults : r.empty}</h2>
            {!query && (
              <>
                <p className="muted">{w.receiptSetupText}</p>
                <Link className="secondary-button" href="/purchases/catalog">
                  {w.openCatalog}
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{r.code}</th>
                    <th>{r.source}</th>
                    <th>{r.quantity}</th>
                    <th>{ui.status}</th>
                    <th>{r.date}</th>
                    <th>{ui.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((receipt) => (
                    <tr key={receipt.id}>
                      <td>
                        <strong dir="ltr">RCV-{receipt.code.padStart(4, '0')}</strong>
                        <small className="cell-subtitle">
                          {receipt.kind === 'opening' ? r.opening : r.purchase}
                        </small>
                      </td>
                      <td>
                        {receipt.supplier_name ?? r.opening}
                        <small className="cell-subtitle">{receipt.reference || '—'}</small>
                      </td>
                      <td>
                        <span dir="ltr">{formatWeight(receipt.total_g)}</span> {r.gram}
                      </td>
                      <td>
                        <span
                          className={`status-pill ${receipt.status === 'posted' ? 'active' : 'inactive'}`}
                        >
                          {r[receipt.status]}
                        </span>
                      </td>
                      <td>
                        <time dateTime={receipt.created_at} dir="ltr">
                          {receipt.created_at.slice(0, 19).replace('T', ' ')}
                        </time>
                      </td>
                      <td>
                        <Link className="quiet-button" href={`/purchases/${receipt.id}`}>
                          {r.details}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>
                {data.items.length} {r.shown}
              </span>
              <Pagination cursor={cursor} next={data.next_cursor} onChange={setCursor} />
            </div>
          </>
        )}
      </section>
      <p className="record-note">{r.timestampHint}</p>
      <dialog
        ref={dialog}
        className="asset-dialog recipe-dialog wizard-dialog"
        aria-labelledby="receipt-form-title"
        onCancel={(e) => {
          if (write.busy) e.preventDefault();
          else setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-heading">
          <h2 id="receipt-form-title">{kind === 'opening' ? r.opening : r.add}</h2>
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
        {open && (
          <ReceiptForm
            userId={userId}
            key={kind}
            kind={kind}
            write={write}
            onClose={() => setOpen(false)}
          />
        )}
      </dialog>
    </>
  );
}
