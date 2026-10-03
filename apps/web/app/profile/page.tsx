'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RequireAuth } from '@/components/RequireAuth';
import { errorMessage } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import type { Session } from '@/lib/types';

function ProfileView() {
  const { user, ep } = useSession();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await ep.sessions());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ep]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    try {
      await ep.revokeSession(id);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <h1>Profile</h1>
      <div className="panel">
        <p>
          <strong>{user?.username}</strong> <span className="muted">· {user?.email}</span>
        </p>
      </div>
      <div className="panel">
        <h2>Signed-in devices</h2>
        <ErrorAlert error={error} />
        {sessions === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Device</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.userAgent ?? 'Unknown device'}{' '}
                    {s.current && <span className="badge green">this device</span>}
                  </td>
                  <td>{new Date(s.lastUsedAt).toLocaleString()}</td>
                  <td>
                    {!s.current && (
                      <button className="btn small danger" onClick={() => void revoke(s.id)}>
                        Sign out
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <main className="content">
      <RequireAuth>
        <ProfileView />
      </RequireAuth>
    </main>
  );
}
