'use client';

import { useCallback, useState } from 'react';
import { Feedback } from '@/components/club-admin/Feedback';
import { useAction } from '@/components/club-admin/useAction';
import { useSession } from '@/lib/session';
import type { AdminClub } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

export function ClubsPanel() {
  const { ep } = useSession();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const fetchPage = useCallback((c: string | null) => ep.adminClubs(query, c), [ep, query]);
  const { items, hasMore, loadMore, reload } = usePaged<AdminClub>(fetchPage);
  const { busy, error, notice, run } = useAction();

  function setStatus(c: AdminClub, status: 'ACTIVE' | 'SUSPENDED') {
    const reason = window.prompt(
      status === 'SUSPENDED'
        ? `Reason for suspending ${c.name}?`
        : `Reason for reinstating ${c.name}?`,
    );
    if (!reason) return;
    void run(async () => {
      await ep.adminSetClubStatus(c.id, status, reason);
      reload();
      return status === 'SUSPENDED'
        ? `${c.name} is suspended (view-only).`
        : `${c.name} is active again.`;
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
          aria-label="Search clubs"
          placeholder="Club name prefix"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn" type="submit">
          Search
        </button>
      </form>
      <Feedback error={error} notice={notice} />
      <table className="list" data-testid="admin-clubs">
        <thead>
          <tr>
            <th>Club</th>
            <th>Owner</th>
            <th>Status</th>
            <th className="num">Members</th>
            <th className="num">Open tables</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((c) => (
            <tr key={c.id} data-club={c.name}>
              <td>{c.name}</td>
              <td>{c.ownerUsername}</td>
              <td>
                <span className={`badge ${c.status === 'ACTIVE' ? 'green' : 'red'}`}>
                  {c.status}
                </span>
              </td>
              <td className="num">{c.memberCount}</td>
              <td className="num">{c.openTables}</td>
              <td className="num">
                {c.status === 'ACTIVE' ? (
                  <button
                    className="btn small danger"
                    disabled={busy}
                    onClick={() => setStatus(c, 'SUSPENDED')}
                  >
                    Suspend
                  </button>
                ) : c.status === 'SUSPENDED' ? (
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() => setStatus(c, 'ACTIVE')}
                  >
                    Reinstate
                  </button>
                ) : null}
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
