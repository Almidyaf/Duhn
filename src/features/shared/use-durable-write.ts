'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import type { z } from 'zod';
import { ui } from '@/locales/ar/ui';
export type Pending = {
  key: string;
  url: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  payload: Record<string, unknown>;
};
export function useDurableWrite(
  userId: string,
  onSaved: (result?: unknown, request?: Pending) => Promise<unknown>,
  config: {
    namespace: string;
    schema: z.ZodType<Pending>;
    saved: string;
    loadError: string;
    errors: Record<string, string>;
  },
) {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const [pending, setPending] = useState<Pending | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const storageKey = `duhn:pending-${config.namespace}:v1:${userId}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setPending(config.schema.parse(JSON.parse(raw)));
      setReady(true);
    } catch {
      setError(ui.storageError);
    } // Do not unlock writes if recovery storage is unreadable.
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [storageKey]);
  function clear() {
    localStorage.removeItem(storageKey);
    setPending(null);
  }
  async function finish(result: unknown, request: Pending) {
    clear();
    setMessage(config.saved);
    try {
      await onSaved(result, request);
      void globalMutate(() => true, undefined, { revalidate: true });
      router.refresh();
    } catch {
      setError(config.loadError);
    }
  }
  async function perform(request: Pending, recoverOnly = false) {
    if (busyRef.current || offline) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = recoverOnly
        ? await fetch(`/api/v1/requests/${request.key}`, { cache: 'no-store' })
        : await fetch(request.url, {
            method: request.method,
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.key },
            body: JSON.stringify(request.payload),
          });
      const result = await response.json();
      if (!response.ok) {
        setError(config.errors[result.code] ?? ui.errors[result.code] ?? ui.networkError);
        if (
          !recoverOnly &&
          [400, 404, 409, 422].includes(response.status) &&
          result.code !== 'IDEMPOTENCY_CONFLICT'
        ) {
          clear();
          if (result.code === 'VERSION_CONFLICT') await onSaved();
        }
        return false;
      }
      if (recoverOnly && result.status !== 'completed') {
        setMessage(ui.unknown);
        return false;
      }
      await finish(recoverOnly ? result.result : result, request);
      return true;
    } catch {
      setError(ui.errors.SERVICE_UNAVAILABLE);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function submit(url: string, method: Pending['method'], payload: Record<string, unknown>) {
    if (pending || busyRef.current || !ready || offline) return false;
    const request = config.schema.parse({ key: crypto.randomUUID(), url, method, payload });
    try {
      localStorage.setItem(storageKey, JSON.stringify(request));
    } catch {
      setError(ui.storageError);
      return false;
    }
    setPending(request);
    return perform(request);
  }
  return {
    pending,
    busy,
    offline,
    error,
    message,
    setError,
    locked: !ready || busy || !!pending || offline,
    submit,
    recover: () => (pending ? perform(pending, true) : Promise.resolve(false)),
    retry: () => (pending ? perform(pending) : Promise.resolve(false)),
  };
}
