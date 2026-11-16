'use client';
import { formatWeight } from '@/contracts/weight';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Bell, CheckCheck, X, ArrowLeft } from 'lucide-react';
import { fetchJson } from '@/features/catalog/shared';
type Notice = {
  id: string;
  title: string;
  body: string;
  href: string;
  severity: string;
  occurred_at: string;
  is_read: boolean;
};
type Feed = {
  items: Notice[];
  unread_count: number;
  next_cursor: { at: string; id: string } | null;
};
export function Notifications({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false),
    [before, setBefore] = useState<Feed['next_cursor']>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  const { data: count, mutate: refreshCount } = useSWR<Feed>(
    ['/api/v1/notifications', userId],
    ([url]) => fetchJson(url),
    { refreshInterval: 15000, revalidateOnFocus: true },
  );
  const params = before
    ? '?' + new URLSearchParams({ before_at: before.at, before_id: before.id })
    : '';
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR<Feed>(
    open ? ['/api/v1/notifications' + params, userId] : null,
    ([url]) => fetchJson(url),
    { refreshInterval: 15000 },
  );
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  async function mark(ids?: string[]) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/v1/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : { all: true }),
      });
      if (!response.ok) throw new Error();
      await Promise.all([mutate(), refreshCount()]);
    } catch {
      setError('تعذر تحديث الإشعارات. أعد المحاولة.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="icon-button notification-bell"
        aria-label={`الإشعارات${count?.unread_count ? '، ' + count.unread_count + ' غير مقروءة' : ''}`}
        onClick={() => {
          setBefore(null);
          setOpen(true);
        }}
      >
        <Bell size={21} />
        {!!count?.unread_count && (
          <span className="notification-count">
            {count.unread_count > 99 ? '99+' : count.unread_count}
          </span>
        )}
      </button>
      <dialog
        ref={ref}
        className="notification-dialog"
        aria-labelledby="notifications-title"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-heading">
          <h2 id="notifications-title">الإشعارات</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="إغلاق الإشعارات"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="notification-tools">
          <span>{count?.unread_count ?? 0} غير مقروءة</span>
          <button
            className="quiet-button"
            disabled={busy || !count?.unread_count}
            onClick={() => mark()}
          >
            <CheckCheck size={17} /> تعليم الكل كمقروء
          </button>
        </div>
        {(error || loadError) && <p role="alert">{error || 'تعذر جلب الإشعارات.'}</p>}
        <div className="notification-list">
          {!data && !loadError && <p role="status">جارٍ جلب الإشعارات…</p>}
          {data?.items.length === 0 && <p className="empty-state">لا توجد إشعارات حتى الآن.</p>}
          {data?.items.map((n) => (
            <article
              key={n.id}
              className={`notification-item ${n.is_read ? '' : 'unread'} ${n.severity}`}
            >
              <strong>{n.title}</strong>
              <p>{n.body.replace(/\b(\d+\.\d+)(?=\s*جم)/g, (value) => formatWeight(value))}</p>
              <time dateTime={n.occurred_at}>{new Date(n.occurred_at).toLocaleString('ar')}</time>
              <div className="button-row">
                <Link
                  className="quiet-button"
                  href={n.href}
                  onClick={() => {
                    void mark([n.id]);
                    setOpen(false);
                  }}
                >
                  فتح العملية <ArrowLeft size={15} />
                </Link>
                {!n.is_read && (
                  <button className="quiet-button" disabled={busy} onClick={() => mark([n.id])}>
                    تعليم كمقروء
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        <div className="dialog-actions">
          {before && (
            <button className="quiet-button" onClick={() => setBefore(null)}>
              الأحدث
            </button>
          )}
          {data?.next_cursor && (
            <button className="secondary-button" onClick={() => setBefore(data.next_cursor)}>
              إشعارات أقدم
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}
