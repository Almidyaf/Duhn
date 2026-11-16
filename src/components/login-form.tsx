'use client';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { authClient } from './auth-client';
import { ui } from '@/locales/ar/ui';

export function LoginForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const result = await authClient.signIn.email({
        email: String(data.get('email')).trim(),
        password: String(data.get('password')),
      });
      if (result.error) {
        setError(result.error.status === 429 ? ui.loginRateLimited : ui.loginError);
        setBusy(false);
        return;
      }
      window.location.assign('/assets');
    } catch {
      setError(ui.networkError);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="login-form">
      <label htmlFor="email">
        {ui.email}
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          dir="ltr"
          required
          disabled={busy}
        />
      </label>
      <label htmlFor="password">
        {ui.password}
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
          disabled={busy}
        />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? ui.loginBusy : ui.login}
        <ArrowLeft size={18} />
      </button>
      <p className="muted login-hint">{ui.loginHint}</p>
    </form>
  );
}
