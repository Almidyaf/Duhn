'use client';
import { useEffect, useState, useId } from 'react';
import { Search, X } from 'lucide-react';
import { workflowUi as w } from '@/locales/ar/workflow';
import useSWR from 'swr';
import type { CatalogItem, CatalogPage, Cursor } from '@/contracts/catalog';
import type { CatalogWriter } from './use-catalog-write';
import { ui } from '@/locales/ar/ui';
import { catalogUi as c } from '@/locales/ar/catalog';
export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('LOAD_FAILED');
  return response.json();
}
export function WriteFeedback({ write }: { write: CatalogWriter }) {
  return (
    <>
      {write.offline && (
        <p className="notice warning" role="status">
          {ui.offline}
        </p>
      )}
      {write.message && (
        <p className="notice success" role="status">
          {write.message}
        </p>
      )}
      {write.error && (
        <p className="notice danger" role="alert">
          {write.error}
        </p>
      )}
      {write.pending && (
        <div className="pending-box" role="status">
          <div>
            <strong>{ui.pendingTitle}</strong>
            <p>{ui.pendingText}</p>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="secondary-button"
              disabled={write.busy || write.offline}
              onClick={() => write.recover()}
            >
              {ui.checkPending}
            </button>
            <button
              type="button"
              className="quiet-button"
              disabled={write.busy || write.offline}
              onClick={() => write.retry()}
            >
              {ui.resend}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
export function Pagination({
  cursor,
  next,
  onChange,
}: {
  cursor: Cursor | null;
  next: Cursor | null;
  onChange: (cursor: Cursor | null) => void;
}) {
  return (
    <div className="button-row">
      {cursor && (
        <button type="button" className="quiet-button" onClick={() => onChange(null)}>
          {ui.firstPage}
        </button>
      )}
      {next && (
        <button type="button" className="quiet-button" onClick={() => onChange(next)}>
          {ui.next}
        </button>
      )}
    </div>
  );
}
// Each selector is searched and paginated on the server; it never downloads the whole catalog.
export function CatalogPicker({
  label,
  entity,
  typeId,
  kind,
  value,
  onChange,
  disabled = false,
  placeholder,
  emptyText,
  allTypes = false,
}: {
  label: string;
  entity: 'types' | 'products' | 'suppliers';
  typeId?: string;
  kind?: 'raw' | 'finished';
  value: CatalogItem | null;
  onChange: (item: CatalogItem | null) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyText?: string;
  allTypes?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<Cursor | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setCursor(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const params = new URLSearchParams({ status: 'active', q: search });
  if (typeId) params.set('type_id', typeId);
  if (kind) params.set('kind', kind);
  if (cursor) {
    params.set('before_id', cursor.id);
    params.set('before_at', cursor.at);
  }
  const url = `/api/v1/catalog/${entity}?${params}`;
  const { data, error, isLoading, mutate } = useSWR<CatalogPage>(url, fetchJson, {
    refreshInterval: 0,
  });
  const choices = [
    ...(value && !data?.items.some((p) => p.id === value.id) ? [value] : []),
    ...(data?.items ?? []),
  ];
  return (
    <fieldset className="catalog-picker" disabled={disabled || !url}>
      <legend>{label}</legend>
      <div className="picker-search-toggle">
        <button
          type="button"
          className="icon-button"
          aria-label={`${w.searchOptions} · ${label}`}
          aria-expanded={searchOpen}
          aria-controls={searchId}
          onClick={() => {
            setSearchOpen(!searchOpen);
            if (searchOpen) setQuery('');
          }}
        >
          {searchOpen ? <X size={16} /> : <Search size={16} />}
        </button>
      </div>
      {searchOpen && (
        <input
          id={searchId}
          autoFocus
          aria-label={`${c.selectorSearch} · ${label}`}
          value={query}
          maxLength={120}
          placeholder={c.selectorSearch}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <select
        aria-label={label}
        required
        value={value?.id ?? ''}
        onChange={(e) => onChange(choices.find((p) => p.id === e.target.value) ?? null)}
      >
        <option value="">
          {!url ? w.chooseTypeFirst : isLoading ? c.loading : (placeholder ?? c.choose)}
        </option>
        {choices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {error ? (
        <div role="alert">
          {c.loadError}
          <button type="button" className="quiet-button" onClick={() => mutate()}>
            {ui.retry}
          </button>
        </div>
      ) : (
        url && data && !choices.length && <small>{emptyText ?? c.noActive}</small>
      )}
      <Pagination cursor={cursor} next={data?.next_cursor ?? null} onChange={setCursor} />
    </fieldset>
  );
}
