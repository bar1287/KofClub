'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { ApiError, errorMessage } from '@/lib/api/client';
import { safeNext } from '@/lib/nav';
import { useSession } from '@/lib/session';

function LoginForm() {
  const { login } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState({ login: '', password: '', code: '' });
  // Accounts with two-factor authentication: the password was accepted and
  // the same request is sent again with a code (ADR-017).
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form.login.trim(), form.password, needsCode ? form.code.trim() : undefined);
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
        setNeedsCode(true);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label className="field">
        Email or username
        <input
          name="login"
          autoComplete="username"
          required
          value={form.login}
          onChange={(e) => setForm({ ...form, login: e.target.value })}
        />
      </label>
      <label className="field">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </label>
      {needsCode && (
        <label className="field">
          Authentication code
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            data-testid="mfa-code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <span className="muted small">
            The 6-digit code from your authenticator app, or one of your recovery codes.
          </span>
        </label>
      )}
      <ErrorAlert error={error} />
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Logging in…' : 'Log in'}
      </button>
      <p className="muted small">
        New here? <Link href="/register">Create an account</Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="content">
      <div className="panel auth-card">
        <h1>Log in</h1>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
