'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { errorMessage } from '@/lib/api/client';
import { gameLabel } from '@/lib/games';
import { useSession } from '@/lib/session';
import type { Tournament } from '@/lib/types';
import { CreateTournament } from './CreateTournament';
import { buyInLabel, startLabel, STATUS_BADGE, STATUS_LABEL } from './status';

interface Props {
  clubId: string;
  /** Club staff may create tournaments. */
  canManage: boolean;
  /** Called after a registration change (the wallet balance moved). */
  onWalletChange: () => void;
}

/** Club tournaments: list, register/unregister and (staff) create. */
export function TournamentsPanel({ clubId, canManage, onWalletChange }: Props) {
  const { ep } = useSession();
  const [items, setItems] = useState<Tournament[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await ep.tournaments(clubId));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ep, clubId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNotice(message);
      onWalletChange();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel stack" data-testid="tournaments-panel">
      <div className="row">
        <h2 style={{ margin: 0 }}>Tournaments</h2>
        <span className="spacer" />
        {canManage && (
          <button className="btn small" onClick={() => setCreating((c) => !c)}>
            {creating ? 'Close' : 'New tournament'}
          </button>
        )}
      </div>
      <ErrorAlert error={error} />
      {notice && <div className="alert ok">{notice}</div>}
      {creating && (
        <CreateTournament
          clubId={clubId}
          onCreated={(t) => {
            setCreating(false);
            setNotice(`Tournament “${t.name}” created.`);
            void load();
          }}
        />
      )}
      {items && items.length === 0 && <p className="muted">No tournaments yet.</p>}
      {items && items.length > 0 && (
        <table className="list" data-testid="tournament-list">
          <thead>
            <tr>
              <th>Tournament</th>
              <th>Game</th>
              <th>Buy-in</th>
              <th className="num">Players</th>
              <th>Starts</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} data-tournament={t.name}>
                <td>
                  <Link href={`/tournaments/${t.id}`}>{t.name}</Link>
                </td>
                <td>{gameLabel(t.gameType)}</td>
                <td>{buyInLabel(t)}</td>
                <td className="num">
                  {t.registeredCount}/{t.maxPlayers}
                </td>
                <td className="small">{startLabel(t)}</td>
                <td>
                  <span className={STATUS_BADGE[t.status]}>{STATUS_LABEL[t.status]}</span>
                </td>
                <td className="num">
                  {t.status === 'REGISTERING' && !t.registered && (
                    <button
                      className="btn small primary"
                      disabled={busy}
                      onClick={() =>
                        void act(() => ep.registerTournament(t.id), `Registered for ${t.name}.`)
                      }
                    >
                      Register
                    </button>
                  )}
                  {t.status === 'REGISTERING' && t.registered && (
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => ep.unregisterTournament(t.id),
                          `Unregistered from ${t.name}; buy-in refunded.`,
                        )
                      }
                    >
                      Unregister
                    </button>
                  )}
                  {t.status === 'RUNNING' && (
                    <Link className="btn small primary" href={`/tournaments/${t.id}`}>
                      Open
                    </Link>
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
