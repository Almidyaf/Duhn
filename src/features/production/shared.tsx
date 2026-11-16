'use client';
import { useEffect, useState } from 'react';
import { productionUi as p } from '@/locales/ar/production';
import type { Fermentation } from '@/contracts/fermentation';
export function batchCode(code: string) {
  return `B-${code.padStart(6, '0')}`;
}
export function localDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat('ar', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
// Count locally from a server timestamp and a monotonic clock; never write state from the timer.
export function useServerClock(serverTime: string) {
  const [now, setNow] = useState(() => Date.parse(serverTime));
  useEffect(() => {
    const base = performance.now(),
      server = Date.parse(serverTime);
    setNow(server);
    const timer = setInterval(() => setNow(server + performance.now() - base), 1000);
    return () => clearInterval(timer);
  }, [serverTime]);
  return now;
}
export function timedStatus(f: Fermentation, now: number) {
  if (f.status !== 'fermenting') return f.status;
  const remaining = Date.parse(f.due_at) - now;
  if (remaining < -f.grace_minutes * 60000) return 'late';
  if (remaining <= 0) return 'dueNow';
  if (remaining <= f.warning_minutes * 60000) return 'approaching';
  return 'fermenting';
}
export function BatchStatus({ batch, now }: { batch: Fermentation; now: number }) {
  const state = timedStatus(batch, now);
  return (
    <span
      className={`status-pill ${state === 'late' ? 'production-late' : state === 'ready' ? 'active' : 'inactive'}`}
    >
      {p[state]}
    </span>
  );
}
export function duration(ms: number) {
  const s = Math.floor(Math.abs(ms) / 1000),
    hours = Math.floor(s / 3600);
  return `${String(hours).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export async function fetchOptions<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  const body = await r.json();
  if (!r.ok) throw new Error(body.code ?? 'LOAD_FAILED');
  return body;
}
