'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RequireAuth } from '@/components/RequireAuth';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import type { Club } from '@/lib/types';

function ClubsView() {
  const { ep } = useSession();
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [createKey, setCreateKey] = useState(newIdempotencyKey);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setClubs(await ep.myClubs());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ep]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The idempotency key survives retries of this submission only.
      const club = await ep.createClub({ name: name.trim() }, createKey);
      setCreateKey(newIdempotencyKey());
      router.push(`/clubs/${club.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const club = await ep.joinClub(code.trim());
      router.push(`/clubs/${club.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>My clubs</h1>
      <ErrorAlert error={error} />
      <div className="panel">
        {clubs === null ? (
          <p className="muted">Loading…</p>
        ) : clubs.length === 0 ? (
          <p className="muted">You are not in any club yet. Create one or join with a code.</p>
        ) : (
          <table className="list" data-testid="club-list">
            <thead>
              <tr>
                <th>Club</th>
                <th>Your role</th>
                <th className="num">Members</th>
              </tr>
            </thead>
            <tbody>
              {clubs.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/clubs/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>
                    <span className="badge">{c.myRole}</span>
                  </td>
                  <td className="num">{c.memberCount ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="grid-2">
        <form className="panel form" onSubmit={create}>
          <h2>Create a club</h2>
          <label className="field">
            Club name
            <input
              name="clubName"
              required
              minLength={3}
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            Create club
          </button>
        </form>
        <form className="panel form" onSubmit={join}>
          <h2>Join a club</h2>
          <label className="field">
            Join or invite code
            <input
              name="joinCode"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters"
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            Join
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ClubsPage() {
  return (
    <main className="content">
      <RequireAuth>
        <ClubsView />
      </RequireAuth>
    </main>
  );
}
