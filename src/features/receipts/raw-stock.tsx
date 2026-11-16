'use client';
import { formatWeight } from '@/contracts/weight';
import { KgBadge } from '@/components/weight-hint';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Search } from 'lucide-react';
import type { RawLotPage } from '@/contracts/receipts';
import type { Cursor } from '@/contracts/catalog';
import { receiptUi as r } from '@/locales/ar/receipts';
import { ui } from '@/locales/ar/ui';
import { fetchJson, Pagination } from '../catalog/shared';
import { PurchaseNav } from './purchase-nav';
export function RawStock({ initial }: { initial: RawLotPage }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<Cursor | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setCursor(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const params = new URLSearchParams({ q: search });
  if (cursor) {
    params.set('before_at', cursor.at);
    params.set('before_id', cursor.id);
  }
  const url = `/api/v1/materials/lots?${params}`;
  const { data, error, isLoading, mutate } = useSWR<RawLotPage>(url, fetchJson, {
    fallbackData: url === '/api/v1/materials/lots?q=' ? initial : undefined,
  });
  return (
    <>
      <PurchaseNav active="stock" />
      <div className="page-heading">
        <div>
          <h1>{r.stock}</h1>
        </div>
      </div>
      <section className="assets-panel" aria-label={r.stock}>
        <div className="panel-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label={r.stockSearch}
              placeholder={r.stockSearch}
              value={query}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
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
            <h2>{r.emptyStock}</h2>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{r.product}</th>
                    <th>{r.lot}</th>
                    <th>{r.source}</th>
                    <th>{r.balance}</th>
                    <th>{ui.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((lot) => (
                    <tr key={lot.id}>
                      <td>
                        <strong>{lot.product_name}</strong>
                        <small className="cell-subtitle">{lot.type_name}</small>
                      </td>
                      <td dir="ltr">LOT-{lot.code.padStart(4, '0')}</td>
                      <td>
                        {lot.supplier_name ?? r.opening}
                        <small className="cell-subtitle" dir="ltr">
                          RCV-{lot.receipt_code.padStart(4, '0')}
                        </small>
                      </td>
                      <td>
                        <strong dir="ltr">{formatWeight(lot.quantity_g)}</strong> {r.gram}
                        <KgBadge value={lot.quantity_g} />
                      </td>
                      <td>
                        <Link className="quiet-button" href={`/purchases/${lot.receipt_id}`}>
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
    </>
  );
}
