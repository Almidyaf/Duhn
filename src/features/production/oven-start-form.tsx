'use client';
import { formatWeight } from '@/contracts/weight';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { X } from 'lucide-react';
import type { ProductionOrder } from '@/contracts/fermentation';
import type { Cursor } from '@/contracts/catalog';
import { ovenStartSchema, type OvenChoices, type OvenStartInput } from '@/contracts/oven';
import { normalizeWeightInput } from '@/contracts/weight';
import { fetchJson, Pagination, WriteFeedback } from '../catalog/shared';
import type { useProductionWrite } from './use-production-write';
import { productionUi as p } from '@/locales/ar/production';
import { ui } from '@/locales/ar/ui';

export function OvenStartForm({
  order,
  productName,
  orderCode,
  write,
  onClose,
}: {
  order: ProductionOrder;
  productName: string;
  orderCode: string;
  write: ReturnType<typeof useProductionWrite>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const initialUnit = order.duration_minutes % 60 === 0 ? 60 : 1;
  const [amount, setAmount] = useState(String(order.duration_minutes / initialUnit));
  const [unit, setUnit] = useState(initialUnit);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setCursor(null);
      setSelected('');
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const params = new URLSearchParams({ q: search });
  if (cursor) {
    params.set('before_at', cursor.at);
    params.set('before_id', cursor.id);
  }
  const { data, error, isLoading, mutate } = useSWR<OvenChoices>(
    `/api/v1/ovens?${params}`,
    fetchJson,
    { refreshInterval: 15000 },
  );
  const choice =
    data?.items.find((a) => a.id === selected) ??
    (!selected && !cursor && data?.items.length === 1 && !data.next_cursor
      ? data.items[0]
      : undefined);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (write.locked || !choice || error || isLoading) return;
    let payload: OvenStartInput;
    try {
      payload = ovenStartSchema.parse({
        expected_version: order.stage_version,
        asset_id: choice.id,
        asset_version: choice.version,
        duration_minutes: Number(normalizeWeightInput(amount)) * unit,
      });
    } catch {
      write.setError(p.invalidDuration);
      return;
    }
    await write.submit(`/api/v1/production-orders/${order.id}/start`, 'POST', payload);
  }
  return (
    <dialog
      ref={dialog}
      className="asset-dialog"
      aria-labelledby="oven-start-title"
      onCancel={(e) => {
        if (write.busy) e.preventDefault();
        else onClose();
      }}
      onClose={onClose}
    >
      <div className="dialog-heading">
        <h2 id="oven-start-title">{p.startOven}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={ui.cancel}
          disabled={write.busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <form onSubmit={submit}>
        <fieldset className="plain-fieldset" disabled={write.locked}>
          <div className="selected-source">
            <strong>{productName}</strong>
            <span dir="ltr">{orderCode}</span>
            <strong>
              <bdi>{formatWeight(order.quantity_g)}</bdi> {p.gram}
            </strong>
          </div>
          <label>
            {p.searchOvens}
            <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={120} />
          </label>
          <label>
            {p.ovenEquipment}
            <select
              aria-label={p.ovenEquipment}
              required
              value={choice?.id ?? ''}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">{p.chooseOven}</option>
              {data?.items.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <Pagination
            cursor={cursor}
            next={data?.next_cursor ?? null}
            onChange={(value) => {
              setCursor(value);
              setSelected('');
            }}
          />
          {isLoading && <p role="status">{p.loading}</p>}
          {error && (
            <p role="alert">
              {p.loadError}{' '}
              <button type="button" className="quiet-button" onClick={() => mutate()}>
                {p.refresh}
              </button>
            </p>
          )}
          {data && !data.items.length && (
            <p>
              {p.noOvens} <Link href="/assets">{p.manageOvens}</Link>
            </p>
          )}
          <label>
            {p.ovenDuration}
            <input
              dir="ltr"
              inputMode="decimal"
              required
              maxLength={12}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            {p.durationUnit}
            <select
              aria-label={p.durationUnit}
              value={unit}
              onChange={(e) => setUnit(Number(e.target.value))}
            >
              <option value={60}>{p.hours}</option>
              <option value={1}>{p.minutes}</option>
              <option value={1440}>{p.days}</option>
            </select>
          </label>
          <div className="button-row" role="group" aria-label="مدد سريعة للفرن">
            {[
              ['6 ساعات', '6', 60],
              ['12 ساعة', '12', 60],
              ['24 ساعة', '24', 60],
            ].map(([label, val, u]) => (
              <button
                key={label}
                type="button"
                className="quiet-button"
                onClick={() => {
                  setAmount(String(val));
                  setUnit(Number(u));
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <WriteFeedback write={write} />
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={write.busy}
            onClick={onClose}
          >
            {ui.cancel}
          </button>
          <button
            className="primary-button"
            disabled={write.locked || !choice || !!error || isLoading}
          >
            {write.busy ? ui.saving : p.startOven}
          </button>
        </div>
      </form>
    </dialog>
  );
}
