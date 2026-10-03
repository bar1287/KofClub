'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { newIdempotencyKey } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import type { Club, Invite } from '@/lib/types';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export function InvitesPanel({ club, onClubChanged }: { club: Club; onClubChanged: () => void }) {
  const { ep } = useSession();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [form, setForm] = useState({
    role: 'MEMBER' as 'MEMBER' | 'AGENT',
    maxUses: 1,
    expiresInHours: 72,
  });
  const [key, setKey] = useState(newIdempotencyKey);
  const [created, setCreated] = useState<string | null>(null);
  const { busy, error, notice, run } = useAction();

  const load = useCallback(async () => setInvites(await ep.invites(club.id)), [ep, club.id]);
  useEffect(() => {
    void run(load);
  }, [run, load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const res = await ep.createInvite(club.id, form, key);
      setKey(newIdempotencyKey());
      setCreated(res.code);
      await load();
    });
  }

  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Invites</h2>
      <div className="panel" style={{ background: 'var(--panel-2)' }}>
        <div className="row">
          <span>
            Club join code: <strong className="mono">{club.joinCode ?? '—'}</strong>
          </span>
          {club.myRole === 'OWNER' || club.myRole === 'ADMIN' ? (
            <button
              className="btn small"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await ep.rotateJoinCode(club.id);
                  onClubChanged();
                  return 'Join code rotated; the old code no longer works.';
                })
              }
            >
              Rotate
            </button>
          ) : null}
        </div>
      </div>
      <form className="row" onSubmit={create}>
        <label className="field">
          Role
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as 'MEMBER' | 'AGENT' })}
          >
            <option value="MEMBER">Member</option>
            <option value="AGENT">Agent</option>
          </select>
        </label>
        <label className="field">
          Max uses
          <input
            type="number"
            min={1}
            max={10000}
            value={form.maxUses}
            onChange={(e) => setForm({ ...form, maxUses: Math.trunc(Number(e.target.value)) })}
          />
        </label>
        <label className="field">
          Expires in (hours)
          <input
            type="number"
            min={1}
            max={720}
            value={form.expiresInHours}
            onChange={(e) =>
              setForm({ ...form, expiresInHours: Math.trunc(Number(e.target.value)) })
            }
          />
        </label>
        <button
          className="btn primary"
          type="submit"
          disabled={busy}
          style={{ alignSelf: 'flex-end' }}
        >
          Create invite
        </button>
      </form>
      {created && (
        <div className="alert ok">
          Invite code (shown once):{' '}
          <strong className="mono" data-testid="invite-code">
            {created}
          </strong>
        </div>
      )}
      <Feedback error={error} notice={notice} />
      {invites && (
        <table className="list">
          <thead>
            <tr>
              <th>Role</th>
              <th>Uses</th>
              <th>Expires</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invites.map((i) => (
              <tr key={i.id}>
                <td>{i.role}</td>
                <td>
                  {i.useCount}/{i.maxUses}
                </td>
                <td className="small">{new Date(i.expiresAt).toLocaleString()}</td>
                <td>
                  <span className={`badge ${i.status === 'ACTIVE' ? 'green' : ''}`}>
                    {i.status}
                  </span>
                </td>
                <td className="num">
                  {i.status === 'ACTIVE' && (
                    <button
                      className="btn small danger"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await ep.revokeInvite(club.id, i.id);
                          await load();
                          return 'Invite revoked.';
                        })
                      }
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
