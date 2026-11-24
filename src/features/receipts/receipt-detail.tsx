'use client';
import { formatWeight } from '@/contracts/weight';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowRight, X } from 'lucide-react';
import type { ReceiptDetail } from '@/contracts/receipts';
import { voidReceiptSchema } from '@/contracts/receipts';
import { receiptUi as r } from '@/locales/ar/receipts';
import { ui } from '@/locales/ar/ui';
import { fetchJson, WriteFeedback } from '../catalog/shared';
import { PurchaseNav } from './purchase-nav';
import { useReceiptWrite } from './use-receipt-write';
export function ReceiptDetailView({
  initial,
  userId,
  isOwner,
}: {
  initial: ReceiptDetail;
  userId: string;
  isOwner: boolean;
}) {
  const {
    data = initial,
    error,
    mutate,
  } = useSWR<ReceiptDetail>(`/api/v1/receipts/${initial.receipt.id}`, fetchJson, {
    fallbackData: initial,
  });
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const write = useReceiptWrite(userId, async () => {
    setOpen(false);
    await mutate();
  });
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const receipt = data.receipt;
  const canReverse =
    receipt.status === 'posted' &&
    data.lines.every((l) => l.balance_version === 1) &&
    (receipt.kind !== 'opening' || isOwner);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = voidReceiptSchema.safeParse({
      expected_version: version,
      reason: form.get('reason'),
    });
    if (!parsed.success) {
      write.setError(r.errors.INVALID_INPUT);
      return;
    }
    await write.submit(`/api/v1/receipts/${receipt.id}/void`, 'POST', parsed.data);
  }
  return (
    <>
      <PurchaseNav active="receipts" />
      <Link href="/purchases" className="quiet-button">
        <ArrowRight size={16} />
        {r.back}
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{receipt.kind === 'opening' ? r.opening : r.purchase}</p>
          <h1 dir="ltr">RCV-{receipt.code.padStart(4, '0')}</h1>
          <p className="muted">{r.detailLead}</p>
        </div>
        <span className={`status-pill ${receipt.status === 'posted' ? 'active' : 'inactive'}`}>
          {r[receipt.status]}
        </span>
      </div>
      {!open && <WriteFeedback write={write} />}
      {error && (
        <p className="notice danger" role="alert">
          {r.loadError}
          <button className="quiet-button" onClick={() => mutate()}>
            {ui.retry}
          </button>
        </p>
      )}
      <div className="receipt-summary">
        <div>
          <small>{r.source}</small>
          <strong>{receipt.supplier_name ?? (receipt.kind === 'opening' ? r.opening : r.purchase)}</strong>
        </div>
        <div>
          <small>{r.reference}</small>
          <strong>{receipt.reference || '—'}</strong>
        </div>
        <div>
          <small>{r.date}</small>
          <time dir="ltr" dateTime={receipt.created_at}>
            {receipt.created_at.slice(0, 19).replace('T', ' ')}
          </time>
        </div>
        <div>
          <small>{r.quantity}</small>
          <strong>
            <span dir="ltr">{formatWeight(receipt.total_g)}</span> {r.gram}
          </strong>
        </div>
      </div>
      <section className="assets-panel" aria-label={r.details}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{r.product}</th>
                <th>{r.lot}</th>
                <th>{r.quantity}</th>
                <th>{r.balance}</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <strong>{line.product_name}</strong>
                    <small className="cell-subtitle">{line.type_name}</small>
                  </td>
                  <td dir="ltr">LOT-{line.lot_code.padStart(4, '0')}</td>
                  <td>
                    <span dir="ltr">{formatWeight(line.quantity_g)}</span> {r.gram}
                  </td>
                  <td>
                    <strong dir="ltr">{formatWeight(line.balance_g)}</strong> {r.gram}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {receipt.note && <p className="recipe-note receipt-note">{receipt.note}</p>}
      {receipt.void_reason && (
        <p className="notice warning">
          {r.reverseReason}: {receipt.void_reason}
        </p>
      )}
      {receipt.status === 'posted' && (
        <div className="receipt-actions">
          <p className="muted">{r.noReverse}</p>
          <button
            className="secondary-button"
            disabled={!canReverse || write.locked || !!error}
            onClick={() => {
              setVersion(receipt.version);
              write.setError('');
              setOpen(true);
            }}
          >
            {r.reverse}
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="asset-dialog"
        aria-labelledby="void-title"
        onCancel={(e) => {
          if (write.busy) e.preventDefault();
          else setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <div className="dialog-heading">
          <h2 id="void-title">{r.reverse}</h2>
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
        <form key={String(open)} onSubmit={submit}>
          <p>{r.reverseHint}</p>
          <label>
            {r.reverseReason}
            <textarea
              placeholder={r.reverseExample}
              name="reason"
              required
              minLength={3}
              maxLength={1000}
              disabled={write.busy || !!write.pending}
              autoFocus
            />
          </label>
          {open && <WriteFeedback write={write} />}
          <div className="dialog-actions">
            <button className="primary-button" disabled={write.locked}>
              {write.busy ? ui.saving : r.reverseConfirm}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={write.busy}
              onClick={() => setOpen(false)}
            >
              {ui.cancel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
