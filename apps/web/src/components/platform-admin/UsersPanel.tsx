'use client';

import { useCallback, useState } from 'react';
import { Feedback } from '@/components/club-admin/Feedback';
import { useAction } from '@/components/club-admin/useAction';
import { useSession } from '@/lib/session';
import type { AdminUser } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

export function UsersPanel() {
  const { ep, user } = useSession();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const fetchPage = useCallback((c: string | null) => ep.adminUsers(query, c), [ep, query]);
  const { items, hasMore, loadMore, reload } = usePaged<AdminUser>(fetchPage);
  const { busy, error, notice, run } = useAction();

  function setStatus(u: AdminUser, status: 'ACTIVE' | 'SUSPENDED') {
    const reason = window.prompt(
      status === 'SUSPENDED'
        ? `Reason for suspending ${u.username} (recorded in the audit log)?`
        : `Reason for reinstating ${u.username}?`,
    );
    if (!reason) return;
    void run(async () => {
      await ep.adminSetUserStatus(u.id, status, reason);
      reload();
      return status === 'SUSPENDED'
        ? `${u.username} is suspended and signed out everywhere.`
        : `${u.username} is reinstated.`;
    });
  }

  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <input
          aria-label="Search accounts"
          placeholder="Username or email prefix"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn" type="submit">
          Search
        </button>
      </form>
      <Feedback error={error} notice={notice} />
      <table className="list" data-testid="admin-users">
        <thead>
          <tr>
            <th>Account</th>
            <th>Status</th>
            <th className="num">Clubs</th>
            <th className="num">Sessions</th>
            <th>Joined</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((u) => (
            <tr key={u.id} data-user={u.username}>
              <td>
                {u.username}
                {u.platformRole === 'PLATFORM_ADMIN' && (
                  <span className="badge yellow"> admin</span>
                )}
                <div className="muted small">{u.email}</div>
              </td>
              <td>
                <span className={`badge ${u.status === 'ACTIVE' ? 'green' : 'red'}`}>
                  {u.status}
                </span>
              </td>
              <td className="num">{u.clubCount}</td>
              <td className="num">{u.activeSessions}</td>
              <td className="small">{new Date(u.createdAt).toLocaleDateString()}</td>
              <td className="num">
                {u.platformRole !== 'PLATFORM_ADMIN' &&
                  u.id !== user?.id &&
                  (u.status === 'ACTIVE' ? (
                    <button
                      className="btn small danger"
                      disabled={busy}
                      onClick={() => setStatus(u, 'SUSPENDED')}
                    >
                      Suspend
                    </button>
                  ) : u.status === 'SUSPENDED' ? (
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => setStatus(u, 'ACTIVE')}
                    >
                      Reinstate
                    </button>
                  ) : null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && (
        <button className="btn" onClick={loadMore}>
          Load more
        </button>
      )}
    </div>
  );
}
