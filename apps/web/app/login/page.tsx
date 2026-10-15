'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent, type ReactNode } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { ApiError, errorMessage } from '@/lib/api/client';
import { safeNext } from '@/lib/nav';
import { useSession } from '@/lib/session';
import { useOperatorSlug } from '@/lib/useOperator';

/**
 * Inside the Telegram Mini App (ADR-018): continue with the Telegram
 * account, creating a KofClub account for it on first use.
 */
function TelegramSignIn({ onDone }: { onDone: () => void }) {
  const { telegram, loginWithTelegram } = useSession();
  const operatorSlug = useOperatorSlug();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!telegram) return null;

  async function go(opts: { create?: boolean; mfaCode?: string }) {
    setBusy(true);
    setError(null);
    try {
      await loginWithTelegram(opts);
      onDone();
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'MFA_REQUIRED')) setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (telegram.state === 'failed') {
    return <ErrorAlert error={telegram.message} />;
  }
  if (telegram.state === 'mfa-required') {
    return (
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void go({ mfaCode: code.trim() });
        }}
      >
        <label className="field">
          Authentication code
          <input
            name="telegramCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <span className="muted small">Your account uses two-factor authentication.</span>
        </label>
        <ErrorAlert error={error} />
        <button className="btn primary" type="submit" disabled={busy}>
          Continue with Telegram
        </button>
      </form>
    );
  }
  const isNew = telegram.state === 'not-linked';
  return (
    <div className="stack" data-testid="telegram-sign-in">
      {isNew && (
        <p>
          {telegram.firstName ? `Hi ${telegram.firstName}! ` : ''}Start playing with your Telegram
          account: no email or password needed.
        </p>
      )}
      <ErrorAlert error={error} />
      <button
        className="btn primary"
        type="button"
        disabled={busy}
        onClick={() => void go(isNew ? { create: true } : {})}
      >
        Continue with Telegram
      </button>
      {isNew && !operatorSlug && (
        <p className="muted small">
          Already have a KofClub account? Log in below to sign in with Telegram from now on.
        </p>
      )}
    </div>
  );
}

function LoginForm() {
  const { login, telegram, linkTelegram } = useSession();
  const operatorSlug = useOperatorSlug();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [form, setForm] = useState({ login: '', password: '', code: '' });
  // Accounts with two-factor authentication: the password was accepted and
  // the same request is sent again with a code (ADR-017).
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // In Telegram, an account without a Telegram link can take this one.
  const canLink = telegram?.state === 'not-linked';
  const [link, setLink] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form.login.trim(), form.password, needsCode ? form.code.trim() : undefined);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
        setNeedsCode(true);
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
      return;
    }
    if (canLink && link) {
      try {
        await linkTelegram();
      } catch (err) {
        // Signed in, but not linked: say why before moving on.
        setLinkError(errorMessage(err));
        setBusy(false);
        return;
      }
    }
    router.replace(next);
  }

  if (linkError) {
    return (
      <div className="stack">
        <ErrorAlert error={`You are logged in, but Telegram was not linked: ${linkError}`} />
        <Link className="btn primary" href={next}>
          Continue
        </Link>
      </div>
    );
  }

  // Operator worlds sign in with the operator's bot only (ADR-019).
  if (operatorSlug) {
    return <TelegramSignIn onDone={() => router.replace(next)} />;
  }
  return (
    <div className="stack">
      <TelegramSignIn onDone={() => router.replace(next)} />
      <LoginFields
        form={form}
        setForm={setForm}
        needsCode={needsCode}
        error={error}
        busy={busy}
        submit={submit}
        linkOption={
          canLink ? (
            <label className="row small">
              <input
                type="checkbox"
                name="linkTelegram"
                checked={link}
                onChange={(e) => setLink(e.target.checked)}
              />
              Sign in with this Telegram account from now on
            </label>
          ) : null
        }
      />
    </div>
  );
}

function LoginFields({
  form,
  setForm,
  needsCode,
  error,
  busy,
  submit,
  linkOption,
}: {
  form: { login: string; password: string; code: string };
  setForm: (f: { login: string; password: string; code: string }) => void;
  needsCode: boolean;
  error: string | null;
  busy: boolean;
  submit: (e: FormEvent) => Promise<void>;
  linkOption: ReactNode;
}) {
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
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
      {linkOption}
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
