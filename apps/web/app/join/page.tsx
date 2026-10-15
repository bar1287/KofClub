'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RequireAuth } from '@/components/RequireAuth';
import { errorMessage } from '@/lib/api/client';
import { useSession } from '@/lib/session';

/**
 * A club invitation link (from the Telegram bot or a shared t.me link):
 * shows the code and joins only when the player confirms.
 */
function JoinView() {
  const { ep } = useSession();
  const router = useRouter();
  const code = (useSearchParams().get('code') ?? '').trim().toUpperCase();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const club = await ep.joinClub(code);
      router.replace(`/clubs/${club.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!/^[A-Z0-9]{6,16}$/.test(code)) {
    return (
      <div className="panel stack">
        <h1>Join a club</h1>
        <p className="muted">This invitation link is incomplete.</p>
        <Link href="/clubs">Enter a code on the clubs page</Link>
      </div>
    );
  }
  return (
    <div className="panel stack" data-testid="join-club">
      <h1>Join a club</h1>
      <p>
        You were invited with the code <strong className="mono">{code}</strong>.
      </p>
      <p className="muted small">Clubs play with virtual chips that have no monetary value.</p>
      <ErrorAlert error={error} />
      <div className="row">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void join()}>
          {busy ? 'Joining…' : 'Join club'}
        </button>
        <Link className="btn" href="/clubs">
          Not now
        </Link>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <main className="content">
      <RequireAuth>
        <Suspense>
          <JoinView />
        </Suspense>
      </RequireAuth>
    </main>
  );
}
