'use client';
import { ui } from '@/locales/ar/ui';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone-message">
      <h1>{ui.appError}</h1>
      <p>{ui.appErrorText}</p>
      <button className="primary-button" onClick={reset}>
        {ui.retry}
      </button>
    </main>
  );
}
