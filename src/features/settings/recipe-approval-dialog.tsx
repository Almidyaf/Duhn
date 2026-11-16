'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import {
  recipeApprovalSchema,
  recipeDisableSchema,
  type FactorySettings,
} from '@/contracts/settings';
import type { RecipeVersion, CatalogItem } from '@/contracts/catalog';
import { settingsUi as s } from '@/locales/ar/settings';
import { ui } from '@/locales/ar/ui';
import { fetchJson, WriteFeedback } from '../catalog/shared';
import { useConfigurationWrite } from './use-configuration-write';
export function RecipeApprovalDialog({
  selected,
  productId,
  userId,
  onClose,
  onSaved,
}: {
  selected: RecipeVersion | null;
  productId: string;
  userId: string;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [versions, setVersions] = useState<{ product: number; settings: number } | null>(null);
  const [configured, setConfigured] = useState(false);
  const write = useConfigurationWrite(userId, async () => {
    onClose();
    await onSaved();
  });
  const selectedId = selected?.id;
  const disabling = !!selected?.active;
  useEffect(() => {
    if (!selectedId) {
      dialog.current?.close();
      return;
    }
    dialog.current?.showModal();
    setVersions(null);
    write.setError('');
    let live = true;
    Promise.all([
      fetchJson<{ item: CatalogItem }>(`/api/v1/catalog/products/${productId}`),
      fetchJson<FactorySettings>('/api/v1/settings'),
    ])
      .then(([product, settings]) => {
        if (live) {
          setVersions({ product: product.item.version, settings: settings.version });
          setConfigured(settings.configured);
        }
      })
      .catch(() => {
        if (live) write.setError(s.loadError);
      });
    return () => {
      live = false;
    };
  }, [selectedId, productId]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !versions || write.locked) return;
    const form = new FormData(event.currentTarget);
    const parsed = disabling
      ? recipeDisableSchema.safeParse({
          expected_version: versions.product,
          reason: form.get('note'),
        })
      : recipeApprovalSchema.safeParse({
          expected_version: versions.product,
          settings_version: versions.settings,
          note: form.get('note'),
          process_confirmed: form.get('confirmed') === 'on',
        });
    if (!parsed.success) {
      write.setError(s.errors.INVALID_INPUT);
      return;
    }
    await write.submit(
      `/api/v1/catalog/products/${productId}/recipes/${disabling ? 'disable' : `${selected.id}/approve`}`,
      'POST',
      parsed.data,
    );
  }
  return (
    <>
      {!selected && <WriteFeedback write={write} />}
      <dialog
        ref={dialog}
        className="asset-dialog recipe-dialog"
        aria-labelledby="approval-title"
        onCancel={(e) => {
          if (write.busy) e.preventDefault();
          else onClose();
        }}
        onClose={onClose}
      >
        <div className="dialog-heading">
          <h2 id="approval-title">{disabling ? s.disableTitle : s.approvalTitle}</h2>
          <button
            className="icon-button"
            type="button"
            aria-label={ui.cancel}
            disabled={write.busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <form key={selectedId ?? 'none'} onSubmit={submit}>
          <p>{disabling ? s.disableHint : s.hint}</p>
          {!versions && <p role="status">{s.loading}</p>}
          {versions && !configured && !disabling && (
            <p className="notice warning">
              {s.unconfigured}
              <Link href="/settings">{s.goSettings}</Link>
            </p>
          )}
          <fieldset
            className="plain-fieldset"
            disabled={!versions || write.locked || (!configured && !disabling)}
          >
            <label>
              {disabling ? s.reason : s.note}
              <textarea
                placeholder={disabling ? s.disableExample : s.approvalExample}
                name="note"
                required
                minLength={3}
                maxLength={1000}
                rows={3}
              />
            </label>
            {!disabling && (
              <label className="checkbox-label">
                <input type="checkbox" name="confirmed" required />
                {s.confirmation}
              </label>
            )}
            <button className="primary-button" disabled={write.locked}>
              {write.busy ? ui.saving : disabling ? s.saveDisable : s.saveApproval}
            </button>
          </fieldset>
          {selected && <WriteFeedback write={write} />}
        </form>
      </dialog>
    </>
  );
}
