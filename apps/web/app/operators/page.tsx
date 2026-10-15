'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RequireAuth } from '@/components/RequireAuth';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { slugFromName } from '@/lib/operators';
import { useSession } from '@/lib/session';
import type { Operator } from '@/lib/types';

const STATUS_TEXT: Record<Operator['status'], string> = {
  PENDING: 'Waiting for approval',
  ACTIVE: 'Live',
  SUSPENDED: 'Suspended',
  REJECTED: 'Not approved',
};

/**
 * Run your own poker service on Telegram (T3, ADR-019): register your bot,
 * wait for approval, then point the bot's Mini App at your world.
 */
function OperatorsView() {
  const { ep } = useSession();
  const [operators, setOperators] = useState<Operator[] | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', botToken: '', terms: false });
  const [slugEdited, setSlugEdited] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOperators(await ep.myOperators());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ep]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ep.registerOperator(
        {
          name: form.name.trim(),
          slug: form.slug,
          botToken: form.botToken.trim(),
          acceptTerms: true,
        },
        key,
      );
      setKey(newIdempotencyKey());
      setForm({ name: '', slug: '', botToken: '', terms: false });
      setSlugEdited(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Your own poker bot</h1>
      <p>
        Run private poker clubs under your own Telegram bot: your name, your players, your clubs.
        KofClub runs the games for you.
      </p>
      <div className="alert info">
        Chips are always virtual and free. Playing for money in any form, including settling up
        outside the app, is forbidden; bots that allow it are suspended.
      </div>

      {operators && operators.length > 0 && (
        <div className="stack" data-testid="my-operators">
          {operators.map((o) => (
            <OperatorCard key={o.id} operator={o} onChanged={load} />
          ))}
        </div>
      )}

      <form className="panel form" onSubmit={submit} data-testid="register-operator">
        <h2>Register a bot</h2>
        <ol className="small">
          <li>
            In Telegram, open <span className="mono">@BotFather</span>, send{' '}
            <span className="mono">/newbot</span> and choose a name and username.
          </li>
          <li>Copy the token BotFather gives you and paste it below.</li>
          <li>After approval, set the bot&apos;s Mini App address (shown here).</li>
        </ol>
        <label className="field">
          Service name (players see it)
          <input
            name="operatorName"
            required
            minLength={2}
            maxLength={48}
            value={form.name}
            onChange={(e) =>
              setForm({
                ...form,
                name: e.target.value,
                slug: slugEdited ? form.slug : slugFromName(e.target.value),
              })
            }
          />
        </label>
        <label className="field">
          Address (lowercase letters, digits and dashes)
          <input
            name="operatorSlug"
            required
            pattern="[a-z0-9][a-z0-9-]{2,31}"
            value={form.slug}
            onChange={(e) => {
              setSlugEdited(true);
              setForm({ ...form, slug: e.target.value });
            }}
          />
        </label>
        <label className="field">
          Bot token
          <input
            name="botToken"
            required
            autoComplete="off"
            spellCheck={false}
            value={form.botToken}
            onChange={(e) => setForm({ ...form, botToken: e.target.value })}
          />
          <span className="muted small">Stored encrypted. Never share it with anyone else.</span>
        </label>
        <label className="row small">
          <input
            type="checkbox"
            name="acceptTerms"
            required
            checked={form.terms}
            onChange={(e) => setForm({ ...form, terms: e.target.checked })}
          />
          I accept the terms: virtual chips only, no play for money of any kind.
        </label>
        <ErrorAlert error={error} />
        <button className="btn primary" type="submit" disabled={busy || !form.terms}>
          {busy ? 'Checking the bot…' : 'Register bot'}
        </button>
      </form>
    </div>
  );
}

function OperatorCard({ operator, onChanged }: { operator: Operator; onChanged: () => void }) {
  const { ep } = useSession();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function replace(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await ep.replaceOperatorToken(operator.id, token.trim());
      setToken('');
      setNotice('Token replaced.');
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const badge =
    operator.status === 'ACTIVE' ? 'green' : operator.status === 'PENDING' ? 'yellow' : 'red';
  return (
    <div className="panel stack" data-testid="operator-card">
      <div className="row">
        <h2 style={{ margin: 0 }}>{operator.name}</h2>
        <span className={`badge ${badge}`}>{STATUS_TEXT[operator.status]}</span>
        <span className="spacer" />
        <a href={`https://t.me/${operator.botUsername}`} target="_blank" rel="noreferrer">
          @{operator.botUsername}
        </a>
      </div>
      {operator.statusReason && operator.status !== 'ACTIVE' && (
        <p className="muted small">Reason: {operator.statusReason}</p>
      )}
      <p className="small">
        In <span className="mono">@BotFather</span>: Bot Settings → Configure Mini App → Enable Mini
        App, and set this address:
        <br />
        <code className="mono" data-testid="operator-mini-app-url">
          {operator.miniAppUrl}
        </code>
      </p>
      {operator.status === 'ACTIVE' && (
        <p className="small">
          Share <span className="mono">https://t.me/{operator.botUsername}</span> with your players.
          Clubs are created and joined inside your bot.
        </p>
      )}
      <form className="row" onSubmit={replace}>
        <input
          name="replaceToken"
          aria-label="New bot token"
          placeholder="New token (after /revoke in BotFather)"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button className="btn small" type="submit" disabled={busy || token.trim().length < 30}>
          Replace token
        </button>
      </form>
      <ErrorAlert error={error} />
      {notice && <div className="alert ok">{notice}</div>}
    </div>
  );
}

export default function OperatorsPage() {
  return (
    <main className="content">
      <RequireAuth>
        <OperatorsView />
      </RequireAuth>
    </main>
  );
}
