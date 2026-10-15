'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { errorMessage } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { useOperatorSlug } from '@/lib/useOperator';

export default function RegisterPage() {
  const { register, telegram } = useSession();
  const operatorSlug = useOperatorSlug();
  const router = useRouter();
  const [form, setForm] = useState({ email: '', username: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form.email.trim(), form.username.trim(), form.password);
      router.replace('/clubs');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="content">
      <div className="panel auth-card">
        <h1>Create an account</h1>
        {operatorSlug && (
          <p className="alert info" data-testid="register-operator">
            Accounts here are made with Telegram: <Link href="/login">continue with Telegram</Link>.
          </p>
        )}
        {telegram && (
          <p className="alert ok" data-testid="register-telegram">
            In Telegram you can play without email or password:{' '}
            <Link href="/login">continue with Telegram</Link>.
          </p>
        )}
        <form className="form" onSubmit={submit}>
          <label className="field">
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="field">
            Username (3–24 letters, digits or _)
            <input
              name="username"
              autoComplete="username"
              required
              pattern="[A-Za-z0-9_]{3,24}"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label className="field">
            Password (at least 10 characters)
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <ErrorAlert error={error} />
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <p className="muted small">
            Already have an account? <Link href="/login">Log in</Link>
          </p>
        </form>
      </div>
    </main>
  );
}
