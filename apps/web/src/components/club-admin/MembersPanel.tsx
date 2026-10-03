'use client';

import { useCallback, useState } from 'react';
import { atLeast } from '@/lib/roles';
import { useSession } from '@/lib/session';
import type { Club, Member } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

const ROLES = ['MEMBER', 'AGENT', 'ADMIN'] as const;

/** Roles, bans and ownership transfer. The API applies the full rule set. */
export function MembersPanel({ club, onClubChanged }: { club: Club; onClubChanged: () => void }) {
  const { ep, user } = useSession();
  const [status, setStatus] = useState<'ACTIVE' | 'BANNED'>('ACTIVE');
  const fetchPage = useCallback(
    (cursor: string | null) => ep.membersByStatus(club.id, status, cursor),
    [ep, club.id, status],
  );
  const { items, hasMore, loadMore, reload } = usePaged<Member>(fetchPage);
  const { busy, error, notice, run } = useAction();
  const isOwner = club.myRole === 'OWNER';
  const canManage = atLeast(club.myRole, 'ADMIN');

  const update = (m: Member, body: Parameters<typeof ep.updateMember>[2], done: string) =>
    run(async () => {
      await ep.updateMember(club.id, m.userId, body);
      reload();
      return done;
    });

  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Members</h2>
        <span className="spacer" />
        <select
          aria-label="Member status"
          value={status}
          onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'BANNED')}
        >
          <option value="ACTIVE">Active</option>
          <option value="BANNED">Banned</option>
        </select>
      </div>
      <Feedback error={error} notice={notice} />
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="list" data-testid="admin-members">
          <thead>
            <tr>
              <th>Player</th>
              <th>Role</th>
              <th>Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => {
              const editable = canManage && m.role !== 'OWNER' && m.userId !== user?.id;
              return (
                <tr key={m.userId} data-member={m.username}>
                  <td>{m.username}</td>
                  <td>
                    {editable && m.status === 'ACTIVE' ? (
                      <select
                        aria-label={`Role of ${m.username}`}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) =>
                          void update(
                            m,
                            { role: e.target.value as (typeof ROLES)[number] },
                            `${m.username} is now ${e.target.value}.`,
                          )
                        }
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="badge">{m.role}</span>
                    )}
                  </td>
                  <td className="small">{new Date(m.joinedAt).toLocaleDateString()}</td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      {editable &&
                        (m.status === 'ACTIVE' ? (
                          <button
                            className="btn small danger"
                            disabled={busy}
                            onClick={() =>
                              void update(m, { status: 'BANNED' }, `${m.username} was banned.`)
                            }
                          >
                            Ban
                          </button>
                        ) : (
                          <button
                            className="btn small"
                            disabled={busy}
                            onClick={() =>
                              void update(m, { status: 'ACTIVE' }, `${m.username} was unbanned.`)
                            }
                          >
                            Unban
                          </button>
                        ))}
                      {isOwner && m.status === 'ACTIVE' && m.userId !== user?.id && (
                        <button
                          className="btn small"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`Make ${m.username} the owner of ${club.name}?`))
                              return;
                            void run(async () => {
                              await ep.transferOwnership(club.id, m.userId);
                              onClubChanged();
                              reload();
                              return `${m.username} now owns the club; you are an admin.`;
                            });
                          }}
                        >
                          Make owner
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {hasMore && (
        <button className="btn" onClick={loadMore}>
          Load more
        </button>
      )}
      <p className="muted small">
        Banned members cannot join tables or receive chips; chips at a table are always returned to
        their wallet when they leave.
      </p>
    </div>
  );
}
