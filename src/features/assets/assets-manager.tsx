'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { z } from 'zod';
import {
  Plus,
  Search,
  Boxes,
  MapPin,
  Pencil,
  Trash2,
  X,
  ArrowLeft,
  CircleCheck,
  ShieldCheck,
} from 'lucide-react';
import {
  assetCategories,
  assetDeleteSchema,
  assetInputSchema,
  assetUpdateSchema,
  type Asset,
} from '@/contracts/assets';
import { ui } from '@/locales/ar/ui';

type Page = { items: Asset[]; next_cursor: { at: string; id: string } | null };
const pendingSchema = z.object({
  key: z.uuid(),
  url: z.string().regex(/^\/api\/v1\/assets(?:\/[0-9a-f-]{36})?$/),
  method: z.enum(['POST', 'PATCH', 'DELETE']),
  payload: z.union([assetUpdateSchema, assetInputSchema, assetDeleteSchema]),
});
type Pending = z.infer<typeof pendingSchema>;
const initialUrl = '/api/v1/assets?q=&status=all';
async function fetchPage(url: string): Promise<Page> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('LOAD_FAILED');
  return response.json();
}

export function AssetsManager({ initial, userId }: { initial: Page; userId: string }) {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [cursor, setCursor] = useState<Page['next_cursor']>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const storageKey = `duhn:pending-asset:v1:${userId}`;
  const params = new URLSearchParams({ q: search, status });
  if (cursor) {
    params.set('before_at', cursor.at);
    params.set('before_id', cursor.id);
  }
  const url = `/api/v1/assets?${params}`;
  const {
    data,
    error: loadError,
    isLoading,
    mutate,
  } = useSWR(url, fetchPage, {
    fallbackData: url === initialUrl ? initial : undefined,
    revalidateOnFocus: false,
    refreshInterval: 0,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setCursor(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setPending(pendingSchema.parse(JSON.parse(raw)));
    } catch {
      setError(ui.storageError);
    }
    setReady(true);
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [storageKey]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (deleteTarget) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleteTarget]);

  function openDelete(asset: Asset) {
    setError('');
    setMessage('');
    setDeleteTarget(asset);
  }

  async function sendAssetRequest(request: Pending) {
    if (pending || busyRef.current || !ready || offline) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(request));
    } catch {
      setError(ui.storageError);
      return;
    }
    setPending(request);
    await perform(request);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await sendAssetRequest({
      key: crypto.randomUUID(),
      url: `/api/v1/assets/${deleteTarget.id}`,
      method: 'DELETE',
      payload: { expected_version: deleteTarget.version },
    });
  }

  async function deactivateInstead() {
    if (!deleteTarget) return;
    await sendAssetRequest({
      key: crypto.randomUUID(),
      url: `/api/v1/assets/${deleteTarget.id}`,
      method: 'PATCH',
      payload: {
        name: deleteTarget.name,
        category: deleteTarget.category,
        location: deleteTarget.location,
        notes: deleteTarget.notes,
        active: false,
        expected_version: deleteTarget.version,
      },
    });
  }

  function clearPending() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* A remaining completed key can safely be checked again. */
    }
    setPending(null);
  }
  function beginEdit(asset: Asset | null) {
    setSelected(asset);
    setError('');
    setMessage('');
    setOpen(true);
  }
  async function perform(request: Pending) {
    if (busyRef.current || offline) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.key },
        body: JSON.stringify(request.payload),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(ui.errors[result.code] ?? ui.errors.SERVICE_UNAVAILABLE);
        if (
          [400, 404, 409, 422].includes(response.status) &&
          result.code !== 'IDEMPOTENCY_CONFLICT'
        ) {
          clearPending();
          if (result.code === 'VERSION_CONFLICT') {
            setOpen(false);
            await mutate();
          }
        }
        return;
      }
      clearPending();
      setOpen(false);
      setDeleteTarget(null);
      setMessage(
        request.method === 'DELETE' ? 'تم حذف الأصل بنجاح.' : request.method === 'POST' ? ui.saved : ui.updated,
      );
      await mutate();
      void globalMutate(() => true, undefined, { revalidate: true });
      router.refresh();
    } catch {
      setError(ui.errors.SERVICE_UNAVAILABLE);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || busyRef.current || !ready || offline) return;
    const form = new FormData(event.currentTarget);
    const fields = {
      name: form.get('name'),
      category: form.get('category'),
      location: form.get('location'),
      notes: form.get('notes'),
    };
    const parsed = selected
      ? assetUpdateSchema.safeParse({
          ...fields,
          active: form.get('active') === 'on',
          expected_version: selected.version,
        })
      : assetInputSchema.safeParse(fields);
    if (!parsed.success) {
      setError(ui.errors.INVALID_INPUT);
      return;
    }
    const request: Pending = {
      key: crypto.randomUUID(),
      url: selected ? `/api/v1/assets/${selected.id}` : '/api/v1/assets',
      method: selected ? 'PATCH' : 'POST',
      payload: parsed.data,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(request));
    } catch {
      setError(ui.storageError);
      return;
    }
    setPending(request);
    await perform(request);
  }
  async function recover() {
    if (!pending || busyRef.current || offline) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/requests/${pending.key}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) {
        setError(ui.errors[result.code] ?? ui.networkError);
        return;
      }
      if (result.status === 'completed') {
        clearPending();
        setOpen(false);
        setMessage(ui.saved);
        await mutate();
        void globalMutate(() => true, undefined, { revalidate: true });
        router.refresh();
      } else setMessage(ui.unknown);
    } catch {
      setError(ui.networkError);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const locked = !ready || busy || !!pending || offline;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{ui.pageEyebrow}</p>
          <h1>{ui.assetsTitle}</h1>
          <p className="muted">{ui.assetsLead}</p>
        </div>
        <button className="primary-button" disabled={locked} onClick={() => beginEdit(null)}>
          <Plus size={19} />
          {ui.add}
        </button>
      </div>
      {offline && (
        <div className="notice warning" role="status">
          {ui.offline}
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          <CircleCheck size={18} />
          {message}
        </div>
      )}
      {error && !open && !deleteTarget && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      {pending && (
        <div className="pending-box" role="status">
          <div>
            <strong>{ui.pendingTitle}</strong>
            <p>{ui.pendingText}</p>
          </div>
          <div className="button-row">
            <button disabled={busy || offline} className="secondary-button" onClick={recover}>
              {ui.checkPending}
            </button>
            <button
              disabled={busy || offline}
              className="quiet-button"
              onClick={() => perform(pending)}
            >
              {ui.resend}
            </button>
          </div>
        </div>
      )}
      <section className="assets-panel" aria-label={ui.assetsTitle}>
        <div className="panel-toolbar">
          <div className="search-field">
            <Search size={19} />
            <input
              aria-label={ui.search}
              value={query}
              maxLength={120}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={ui.searchPlaceholder}
            />
          </div>
          <select
            aria-label={ui.status}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setCursor(null);
            }}
          >
            <option value="all">{ui.all}</option>
            <option value="active">{ui.active}</option>
            <option value="inactive">{ui.inactive}</option>
          </select>
        </div>
        {loadError ? (
          <div className="empty-state">
            <p role="alert">{ui.loadError}</p>
            <button className="secondary-button" onClick={() => mutate()}>
              {ui.retry}
            </button>
          </div>
        ) : isLoading && !data ? (
          <div className="empty-state" role="status">
            {ui.loading}
          </div>
        ) : !data?.items.length ? (
          <div className="empty-state">
            <span className="empty-icon">
              <Boxes size={34} strokeWidth={1.4} />
            </span>
            <h2>{search || status !== 'all' ? ui.noResults : ui.emptyTitle}</h2>
            {!search && status === 'all' && (
              <>
                <p className="muted">{ui.emptyText}</p>
                <button
                  className="secondary-button"
                  disabled={locked}
                  onClick={() => beginEdit(null)}
                >
                  <Plus size={18} />
                  {ui.add}
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{ui.name}</th>
                    <th>{ui.category}</th>
                    <th>{ui.location}</th>
                    <th>{ui.status}</th>
                    <th>
                      <span className="sr-only">{ui.action}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((asset) => (
                    <tr key={asset.id}>
                      <td>
                        <div className="asset-name">
                          <span className="asset-icon">
                            <Boxes size={20} />
                          </span>
                          <span>
                            <strong>{asset.name}</strong>
                            <small dir="ltr">AST-{asset.code.padStart(4, '0')}</small>
                          </span>
                        </div>
                      </td>
                      <td>{ui.categories[asset.category]}</td>
                      <td>
                        <span className="location">
                          <MapPin size={14} />
                          {asset.location || ui.noLocation}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill ${asset.active ? 'active' : 'inactive'}`}>
                          <i />
                          {asset.active ? ui.active : ui.inactive}
                        </span>
                      </td>
                      <td>
                        <div className="button-row">
                          <button
                            className="edit-button"
                            disabled={locked}
                            aria-label={`${ui.edit} ${asset.name}`}
                            onClick={() => beginEdit(asset)}
                          >
                            <Pencil size={16} />
                            <span>{ui.edit}</span>
                          </button>
                          <button
                            type="button"
                            className="quiet-button"
                            disabled={locked}
                            aria-label={`حذف ${asset.name}`}
                            onClick={() => openDelete(asset)}
                          >
                            <Trash2 size={15} />
                            <span>حذف</span>
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
                {data.items.length} {ui.shown}
              </span>
              <div className="button-row">
                {cursor && (
                  <button className="quiet-button" onClick={() => setCursor(null)}>
                    {ui.firstPage}
                  </button>
                )}
                {data.next_cursor && (
                  <button className="quiet-button" onClick={() => setCursor(data.next_cursor)}>
                    {ui.next}
                    <ArrowLeft size={16} />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </section>
      <p className="record-note">
        <ShieldCheck size={16} />
        {ui.recordNote}
      </p>
      <dialog
        ref={dialog}
        className="asset-dialog"
        aria-labelledby="asset-dialog-title"
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-heading">
          <h2 id="asset-dialog-title">{selected ? ui.editAsset : ui.add}</h2>
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={ui.cancel}
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <form key={selected?.id ?? 'new'} onSubmit={submit}>
          <label htmlFor="asset-name">
            {ui.name}
            <input
              id="asset-name"
              name="name"
              required
              minLength={2}
              maxLength={120}
              placeholder={ui.namePlaceholder}
              defaultValue={selected?.name}
              disabled={busy || !!pending}
              autoFocus
            />
          </label>
          <label htmlFor="asset-category">
            {ui.category}
            <select
              id="asset-category"
              name="category"
              defaultValue={selected?.category ?? 'equipment'}
              disabled={busy || !!pending}
            >
              {assetCategories.map((category) => (
                <option key={category} value={category}>
                  {ui.categories[category]}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="asset-location">
            {ui.location}
            <span className="optional">{ui.optional}</span>
            <input
              id="asset-location"
              name="location"
              maxLength={120}
              placeholder={ui.locationPlaceholder}
              defaultValue={selected?.location}
              disabled={busy || !!pending}
            />
          </label>
          <label htmlFor="asset-notes">
            {ui.notes}
            <span className="optional">{ui.optional}</span>
            <textarea
              id="asset-notes"
              name="notes"
              maxLength={1000}
              rows={3}
              defaultValue={selected?.notes}
              disabled={busy || !!pending}
            />
          </label>
          {selected && (
            <>
              <label className="checkbox-label">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={selected.active}
                  disabled={busy || !!pending}
                />
                {ui.enabled}
              </label>
              {selected.active && /(ماطور|موتور|motor)/i.test(selected.name) && (
                <small className="field-hint">
                  عند إلغاء تفعيل الماطور (تعطله)، سيتم إيقاف جميع الأفران المشغّلة حاليًا مؤقتًا بشكل تلقائي بسبب تعطل الماطور.
                </small>
              )}
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {pending && !busy && (
            <div className="notice warning">
              <p>{ui.pendingText}</p>
              <button
                type="button"
                className="secondary-button"
                disabled={offline}
                onClick={recover}
              >
                {ui.checkPending}
              </button>
              <button
                type="button"
                className="quiet-button"
                disabled={offline}
                onClick={() => perform(pending)}
              >
                {ui.resend}
              </button>
            </div>
          )}
          <div className="dialog-actions">
            <button className="primary-button" disabled={locked}>
              {busy ? ui.saving : ui.save}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {ui.cancel}
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={deleteDialog}
        className="asset-dialog"
        aria-labelledby="asset-delete-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setDeleteTarget(null);
        }}
        onClose={() => setDeleteTarget(null)}
      >
        <div className="dialog-heading">
          <h2 id="asset-delete-title">تأكيد الحذف الآمن</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={ui.cancel}
            disabled={busy}
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
              الحذف نهائي ولا يمكن التراجع عنه. إذا كان الأصل مرتبطًا بتشغيلات فرن أو أوامر إنتاج فلن يُحذف لحماية السجلات، ويمكنك تعطيله بدلًا من ذلك.
            </p>
            {error && (
              <p className="notice danger" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
              >
                {ui.cancel}
              </button>
              {error === ui.errors.ITEM_IN_USE && deleteTarget.active && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={locked}
                  onClick={deactivateInstead}
                >
                  تعطيل الأصل بدلًا من الحذف
                </button>
              )}
              <button
                type="button"
                className="primary-button"
                disabled={locked}
                onClick={confirmDelete}
              >
                <Trash2 size={16} />
                {busy ? ui.saving : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
