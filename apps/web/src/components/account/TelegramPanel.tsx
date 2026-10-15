'use client';

import { useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { errorMessage } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { useTelegramConfig } from '@/lib/useTelegramConfig';

/** The account's Telegram link (ADR-018): status, link from the Mini App, unlink. */
export function TelegramPanel() {
  const { user, api, ep, telegram, linkTelegram } = useSession();
  const config = useTelegramConfig(ep);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const link = user?.telegram ?? null;
  // Nothing to show where Telegram is off and the account was never linked.
  if (!link && !telegram && !config?.enabled) return null;
  return (
    <div className="panel stack" data-testid="telegram-panel">
      <h2>Telegram</h2>
      {link ? (
        <>
          <p>
            Linked to{' '}
            <strong>
              {link.username ? `@${link.username}` : (link.firstName ?? 'your Telegram account')}
            </strong>{' '}
            <span className="muted small">
              since {new Date(link.linkedAt).toLocaleDateString()}
            </span>
          </p>
          {user?.hasPassword ? (
            <div>
              <button
                className="btn small danger"
                type="button"
                disabled={busy}
                onClick={() => void run(() => api.unlinkTelegram())}
              >
                Unlink Telegram
              </button>
            </div>
          ) : (
            <p className="muted small">This account signs in with Telegram only.</p>
          )}
        </>
      ) : telegram ? (
        <>
          <p className="muted small">Sign in with this Telegram account from now on.</p>
          <div>
            <button
              className="btn small primary"
              type="button"
              disabled={busy}
              onClick={() => void run(linkTelegram)}
            >
              Link Telegram
            </button>
          </div>
        </>
      ) : (
        <p className="muted small">
          Open KofClub from{' '}
          {config?.botUsername ? (
            <a href={`https://t.me/${config.botUsername}`} target="_blank" rel="noreferrer">
              @{config.botUsername}
            </a>
          ) : (
            'our Telegram bot'
          )}{' '}
          to link your Telegram account.
        </p>
      )}
      <ErrorAlert error={error} />
    </div>
  );
}
