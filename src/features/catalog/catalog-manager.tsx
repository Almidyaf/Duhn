'use client';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Plus, Search, Pencil, Trash2, X } from 'lucide-react';
import {
  catalogInputSchemas,
  catalogUpdateSchemas,
  type CatalogEntity,
  type CatalogItem,
  type CatalogPage,
  type Cursor,
  type CatalogView,
} from '@/contracts/catalog';
import { ui } from '@/locales/ar/ui';
import { catalogUi as c } from '@/locales/ar/catalog';
import { PurchaseNav } from '../receipts/purchase-nav';
import { useCatalogWrite } from './use-catalog-write';
import { CatalogPicker, fetchJson, Pagination, WriteFeedback } from './shared';

export function CatalogManager({
  initial,
  userId,
  view: tab,
}: {
  initial: CatalogPage;
  userId: string;
  view: CatalogView;
}) {
  const entity: CatalogEntity = tab === 'raw' || tab === 'finished' ? 'products' : 'suppliers';
  const kind = tab === 'finished' ? 'finished' : 'raw';
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogItem | null>(null);
  const [linkedRaw, setLinkedRaw] = useState<CatalogItem | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);

  const params = new URLSearchParams({ q: search, status });
  if (entity === 'products') params.set('kind', kind);
  if (cursor) {
    params.set('before_at', cursor.at);
    params.set('before_id', cursor.id);
  }
  const url = `/api/v1/catalog/${entity}?${params}`;
  const { data, error, isLoading, mutate } = useSWR<CatalogPage>(url, fetchJson, {
    fallbackData: !search && status === 'all' && !cursor ? initial : undefined,
    refreshInterval: 0,
  });

  const write = useCatalogWrite(userId, async () => {
    setOpen(false);
    setDeleteTarget(null);
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

  useEffect(() => {
    if (deleteTarget) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleteTarget]);

  function openForm(item: CatalogItem | null) {
    write.setError('');
    setSelected(item);
    setLinkedRaw(
      item?.raw_product_id
        ? {
            id: item.raw_product_id,
            name: item.raw_product_name ?? '',
            active: true,
            version: 1,
            created_at: item.created_at,
          }
        : null,
    );
    setOpen(true);
  }

  function openDelete(item: CatalogItem) {
    write.setError('');
    setDeleteTarget(item);
  }

  async function confirmDelete() {
    if (!deleteTarget || write.locked) return;
    await write.submit(`/api/v1/catalog/${entity}/${deleteTarget.id}`, 'DELETE', {
      expected_version: deleteTarget.version,
    });
  }

  async function deactivateInstead() {
    if (!deleteTarget || write.locked) return;
    await write.submit(`/api/v1/catalog/${entity}/${deleteTarget.id}`, 'PATCH', {
      name: deleteTarget.name,
      ...(entity === 'suppliers' ? { contact: deleteTarget.contact ?? '' } : {}),
      active: false,
      expected_version: deleteTarget.version,
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (write.locked) return;
    const form = new FormData(event.currentTarget);
    const fields = {
      name: form.get('name'),
      ...(entity === 'suppliers' ? { contact: form.get('contact') } : {}),
    };
    const parsed = selected
      ? catalogUpdateSchemas[entity].safeParse({
          ...fields,
          active: form.get('active') === 'on',
          expected_version: selected.version,
          ...(entity === 'products' && kind === 'finished' && linkedRaw
            ? { raw_product_id: linkedRaw.id }
            : {}),
        })
      : catalogInputSchemas[entity].safeParse({
          ...fields,
          ...(entity === 'products'
            ? {
                kind,
                ...(kind === 'finished' ? { raw_product_id: linkedRaw?.id } : {}),
              }
            : {}),
        });
    if (!parsed.success) {
      write.setError(
        entity === 'products' && kind === 'finished' && !linkedRaw
          ? 'اختر المادة الخام المرتبطة (العود) أولًا.'
          : c.errors.INVALID_INPUT,
      );
      return;
    }
    await write.submit(
      `/api/v1/catalog/${entity}${selected ? `/${selected.id}` : ''}`,
      selected ? 'PATCH' : 'POST',
      parsed.data,
    );
  }

  const addLabel = tab === 'raw' ? c.addRaw : tab === 'finished' ? c.addFinished : c.add.suppliers;

  return (
    <>
      <PurchaseNav active={tab} />
      {!open && !deleteTarget && <WriteFeedback write={write} />}
      <div className="page-heading catalog-heading">
        <div>
          <h1>{c.tabs[tab]}</h1>
        </div>
        <div className="button-row">
          <button className="primary-button" disabled={write.locked} onClick={() => openForm(null)}>
            <Plus size={18} />
            {addLabel}
          </button>
        </div>
      </div>

      <section className="assets-panel" aria-label={c.tabs[tab]}>
        <div className="panel-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label={c.search}
              placeholder={c.search}
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
            <option value="active">{ui.active}</option>
            <option value="inactive">{ui.inactive}</option>
          </select>
        </div>

        {error ? (
          <div className="empty-state">
            <p role="alert">{c.loadError}</p>
            <button className="secondary-button" onClick={() => mutate()}>
              {ui.retry}
            </button>
          </div>
        ) : isLoading && !data ? (
          <p className="empty-state" role="status">
            {c.loading}
          </p>
        ) : !data?.items.length ? (
          <div className="empty-state">
            <p>{c.empty[entity]}</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {entity === 'products' && <th>الرمز</th>}
                    <th>{ui.name}</th>
                    {tab === 'finished' && <th>المادة الخام (العود)</th>}
                    {tab === 'suppliers' && <th>{c.contact}</th>}
                    <th>{ui.status}</th>
                    <th>{ui.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id}>
                      {entity === 'products' && (
                        <td dir="ltr">PRD-{String(item.code ?? '').padStart(4, '0')}</td>
                      )}
                      <td>
                        <strong>{item.name}</strong>
                      </td>
                      {tab === 'finished' && <td>{item.raw_product_name ?? '—'}</td>}
                      {tab === 'suppliers' && <td>{item.contact || '—'}</td>}
                      <td>
                        <span className={`status-pill ${item.active ? 'active' : 'inactive'}`}>
                          {item.active ? ui.active : ui.inactive}
                        </span>
                      </td>
                      <td>
                        <div className="button-row">
                          <button
                            type="button"
                            className="quiet-button"
                            disabled={write.locked}
                            onClick={() => openForm(item)}
                          >
                            <Pencil size={15} />
                            {ui.edit}
                          </button>
                          <button
                            type="button"
                            className="quiet-button"
                            disabled={write.locked}
                            aria-label={`حذف ${item.name}`}
                            onClick={() => openDelete(item)}
                          >
                            <Trash2 size={15} />
                            حذف
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>
                {data.items.length} {c.shown}
              </span>
              <Pagination cursor={cursor} next={data.next_cursor} onChange={setCursor} />
            </div>
          </>
        )}
      </section>

      <dialog
        ref={dialog}
        className="asset-dialog"
        aria-labelledby="catalog-dialog-title"
        onCancel={(e) => {
          if (write.busy) e.preventDefault();
          else setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-heading">
          <h2 id="catalog-dialog-title">{selected ? ui.edit : addLabel}</h2>
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
        <form key={selected?.id ?? `new-${tab}`} onSubmit={submit}>
          <fieldset className="plain-fieldset" disabled={write.locked}>
            <label>
              {tab === 'raw'
                ? 'اسم المادة الخام (العود)'
                : tab === 'finished'
                  ? 'اسم دهن العود'
                  : ui.name}
              <input name="name" required minLength={2} maxLength={120} defaultValue={selected?.name ?? ''} />
            </label>
            {tab === 'finished' && (
              <CatalogPicker
                label="المادة الخام المرتبطة (العود)"
                placeholder="اختر المادة الخام"
                emptyText="لا توجد مواد خام نشطة — أضف مادة خام أولًا."
                entity="products"
                kind="raw"
                value={linkedRaw}
                onChange={setLinkedRaw}
              />
            )}
            {tab === 'suppliers' && (
              <label>
                {c.contact}
                <input name="contact" maxLength={120} defaultValue={selected?.contact ?? ''} />
              </label>
            )}
            {selected && (
              <label className="checkbox-label">
                <input type="checkbox" name="active" defaultChecked={selected.active} />
                {ui.active}
              </label>
            )}
          </fieldset>
          <WriteFeedback write={write} />
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={write.busy}
              onClick={() => setOpen(false)}
            >
              {ui.cancel}
            </button>
            <button className="primary-button" disabled={write.locked}>
              {write.busy ? ui.saving : ui.save}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={deleteDialog}
        className="asset-dialog"
        aria-labelledby="catalog-delete-title"
        onCancel={(e) => {
          if (write.busy) e.preventDefault();
          else setDeleteTarget(null);
        }}
        onClose={() => setDeleteTarget(null)}
      >
        <div className="dialog-heading">
          <h2 id="catalog-delete-title">تأكيد الحذف الآمن</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={ui.cancel}
            disabled={write.busy}
            onClick={() => setDeleteTarget(null)}
          >
            <X size={20} />
          </button>
        </div>
        {deleteTarget && (
          <div>
            <p>
              هل أنت متأكد من حذف <strong>«{deleteTarget.name}»</strong>؟
            </p>
            <p className="field-hint">
              الحذف نهائي ولا يمكن التراجع عنه. إذا كان العنصر مرتبطًا بدهن أو فواتير أو أوامر إنتاج فلن يُحذف لحماية السجلات، ويمكنك تعطيله بدلًا من ذلك.
            </p>
            <WriteFeedback write={write} />
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={write.busy}
                onClick={() => setDeleteTarget(null)}
              >
                {ui.cancel}
              </button>
              {write.error === c.errors.ITEM_IN_USE && deleteTarget.active && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={write.locked}
                  onClick={deactivateInstead}
                >
                  تعطيل العنصر بدلًا من الحذف
                </button>
              )}
              <button
                type="button"
                className="primary-button"
                disabled={write.locked}
                onClick={confirmDelete}
              >
                <Trash2 size={16} />
                {write.busy ? ui.saving : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
