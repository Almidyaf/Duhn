'use client';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { authClient } from './auth-client';
import { ui } from '@/locales/ar/ui';

export function Logout() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function logout() {
    setBusy(true);
    setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error('SIGNOUT_FAILED');
      window.location.assign('/login');
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="quiet-button" disabled={busy} onClick={logout}>
        <LogOut size={17} />
        {ui.logout}
      </button>
      {error && (
        <p role="alert" className="error-text">
          {ui.networkError}
        </p>
      )}
    </div>
  );
}
