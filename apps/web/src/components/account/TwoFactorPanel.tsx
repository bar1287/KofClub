'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { errorMessage } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import type { MfaStatus, TotpEnrollment } from '@/lib/types';

/** "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP" for manual entry. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}

/** Two-factor authentication (TOTP) settings of the signed-in user (ADR-017). */
export function TwoFactorPanel() {
  const { ep } = useSession();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await ep.mfa());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ep]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => {
      setEnrollment(await ep.startTotp());
      setCode('');
    });

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await ep.confirmTotp(code.trim());
      setRecoveryCodes(res.recoveryCodes);
      setEnrollment(null);
      setCode('');
      await load();
    });
  };

  const disable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await ep.disableTotp(code.trim());
      setCode('');
      setRecoveryCodes(null);
      await load();
    });
  };

  return (
    <div className="panel stack" data-testid="two-factor">
      <h2 style={{ margin: 0 }}>Two-factor authentication</h2>
      <ErrorAlert error={error} />
      {status === null ? (
        <p className="muted">Loading…</p>
      ) : recoveryCodes ? (
        <div className="stack">
          <div className="alert ok">Two-factor authentication is on.</div>
          <p>
            Save these recovery codes somewhere safe. Each one signs you in once if you lose your
            authenticator. They are shown only now.
          </p>
          <ul className="mono" data-testid="recovery-codes">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div>
            <button className="btn" onClick={() => setRecoveryCodes(null)}>
              I saved them
            </button>
          </div>
        </div>
      ) : status.enabled ? (
        <form className="form" onSubmit={disable}>
          <p>
            <span className="badge green">On</span> {status.recoveryCodesLeft} recovery code
            {status.recoveryCodesLeft === 1 ? '' : 's'} left.
            {!status.sessionVerified && (
              <span className="muted">
                {' '}
                This device signed in without a code; sign in again to use administration.
              </span>
            )}
          </p>
          <label className="field">
            Code to turn it off
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <div>
            <button className="btn danger" type="submit" disabled={busy}>
              Turn off
            </button>
          </div>
        </form>
      ) : enrollment ? (
        <form className="form" onSubmit={confirm}>
          <p>
            Add this key to an authenticator app (manual entry, time-based), then enter the code it
            shows.
          </p>
          <p className="mono" data-testid="totp-secret" data-secret={enrollment.secret}>
            {groupSecret(enrollment.secret)}
          </p>
          <p className="small">
            On a phone: <a href={enrollment.otpauthUri}>open in authenticator app</a>
          </p>
          <label className="field">
            Code from the app
            <input
              name="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              data-testid="totp-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" type="submit" disabled={busy}>
              Turn on
            </button>
            <button className="btn" type="button" onClick={() => setEnrollment(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <p className="muted">
            Protect your account with a code from an authenticator app. Required for platform
            administrators.
          </p>
          <div>
            <button className="btn primary" onClick={() => void start()} disabled={busy}>
              Set up two-factor authentication
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
