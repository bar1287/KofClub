'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RequireAuth } from '@/components/RequireAuth';
import {
  buyInLabel,
  startLabel,
  STATUS_BADGE,
  STATUS_LABEL,
} from '@/components/tournaments/status';
import { errorMessage } from '@/lib/api/client';
import { chips, ordinal } from '@/lib/format';
import { gameName } from '@/lib/games';
import { atLeast } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { formatCountdown, useNow } from '@/lib/time';
import type { Club, TournamentDetail } from '@/lib/types';

function TournamentView({ id }: { id: string }) {
  const { ep, user } = useSession();
  const [t, setT] = useState<TournamentDetail | null>(null);
  const [club, setClub] = useState<Club | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow();

  const load = useCallback(async () => {
    try {
      setT(await ep.tournament(id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ep, id]);

  useEffect(() => {
    void load();
  }, [load]);
  // The viewer's club role decides whether staff controls are shown.
  const clubId = t?.clubId;
  useEffect(() => {
    if (clubId)
      void ep
        .club(clubId)
        .then(setClub)
        .catch(() => undefined);
  }, [ep, clubId]);
  // Live while registering or running.
  useEffect(() => {
    if (!t || t.status === 'FINISHED' || t.status === 'CANCELLED') return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [t, load]);

  async function act(fn: () => Promise<TournamentDetail>, message: string) {
    setBusy(true);
    setError(null);
    try {
      setT(await fn());
      setNotice(message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!t) return error ? <ErrorAlert error={error} /> : <p className="muted">Loading…</p>;
  const staff = club ? atLeast(club.myRole, 'ADMIN') : false;
  const registering = t.status === 'REGISTERING';
  const me = t.entrants.find((e) => e.userId === user?.id);

  return (
    <div className="stack">
      <div className="row">
        <Link href={`/clubs/${t.clubId}`} className="small">
          ← Club
        </Link>
        <h1 style={{ margin: 0 }} data-testid="tournament-name">
          {t.name}
        </h1>
        <span className={STATUS_BADGE[t.status]} data-testid="tournament-status">
          {STATUS_LABEL[t.status]}
        </span>
        <span className="spacer" />
        {registering && !t.registered && (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => void act(() => ep.registerTournament(id), 'You are registered.')}
          >
            Register ({buyInLabel(t)})
          </button>
        )}
        {registering && t.registered && (
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void act(() => ep.unregisterTournament(id), 'Unregistered; buy-in refunded.')
            }
          >
            Unregister
          </button>
        )}
        {registering && staff && (
          <>
            <button
              className="btn small"
              disabled={busy}
              onClick={() => void act(() => ep.startTournament(id), 'Starting…')}
            >
              Start now
            </button>
            <button
              className="btn small danger"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Cancel the tournament and refund every buy-in?')) return;
                void act(() => ep.cancelTournament(id), 'Tournament cancelled; buy-ins refunded.');
              }}
            >
              Cancel
            </button>
          </>
        )}
        {t.myTableId && (
          <Link className="btn primary" href={`/tables/${t.myTableId}`} data-testid="my-table">
            Go to my table
          </Link>
        )}
      </div>
      <ErrorAlert error={error} />
      {notice && <div className="alert ok">{notice}</div>}
      {me?.place && (
        <div className="alert info" data-testid="my-result">
          {me.place === 1 ? 'You won the tournament!' : `You finished ${ordinal(me.place)}.`}
          {me.prize > 0 && ` Prize: ${chips(me.prize)} chips.`}
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <h2>Overview</h2>
          <table className="list small">
            <tbody>
              <tr>
                <td>Game</td>
                <td>{gameName(t.gameType)}</td>
              </tr>
              <tr>
                <td>Buy-in</td>
                <td>{buyInLabel(t)}</td>
              </tr>
              <tr>
                <td>Prize pool</td>
                <td data-testid="prize-pool">{chips(t.prizePool)}</td>
              </tr>
              <tr>
                <td>Players</td>
                <td data-testid="tournament-players">
                  {t.status === 'RUNNING'
                    ? `${t.playersLeft} of ${t.registeredCount} left`
                    : `${t.registeredCount} / ${t.maxPlayers} (min ${t.minPlayers})`}
                </td>
              </tr>
              <tr>
                <td>Start</td>
                <td>{startLabel(t)}</td>
              </tr>
              <tr>
                <td>Starting stack</td>
                <td>{chips(t.startingStack)} tournament chips</td>
              </tr>
              <tr>
                <td>Levels</td>
                <td>
                  {Math.round(t.levelDurationSec / 60) >= 1
                    ? `${Math.round(t.levelDurationSec / 60)} min`
                    : `${t.levelDurationSec} s`}{' '}
                  · {t.seatsPerTable}-handed tables
                </td>
              </tr>
              {t.currentLevel && (
                <tr>
                  <td>Current level</td>
                  <td data-testid="current-level">
                    Level {t.currentLevel.level} · {chips(t.currentLevel.smallBlind)}/
                    {chips(t.currentLevel.bigBlind)}
                    {t.levelEndsAt &&
                      ` · next in ${formatCountdown(Date.parse(t.levelEndsAt) - now)}`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>{t.status === 'FINISHED' ? 'Prizes' : 'Payouts'}</h2>
          <table className="list small" data-testid="payouts">
            <tbody>
              {t.payouts.map((p) => (
                <tr key={p.place}>
                  <td>{ordinal(p.place)}</td>
                  <td className="num">{chips(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {registering && <p className="muted small">Projected from the current registrations.</p>}
        </div>
      </div>

      <div className="panel">
        <h2>Players</h2>
        {t.entrants.length === 0 ? (
          <p className="muted">Nobody has registered yet.</p>
        ) : (
          <table className="list" data-testid="entrants">
            <thead>
              <tr>
                <th>Place</th>
                <th>Player</th>
                <th className="num">Chips</th>
                <th className="num">Prize</th>
                <th>Table</th>
              </tr>
            </thead>
            <tbody>
              {t.entrants.map((e) => (
                <tr key={e.userId} data-entrant={e.username}>
                  <td>{e.place ? ordinal(e.place) : ''}</td>
                  <td>{e.username}</td>
                  <td className="num">{e.stack !== null ? chips(e.stack) : ''}</td>
                  <td className="num">{e.prize > 0 ? chips(e.prize) : ''}</td>
                  <td>
                    {e.tableId && t.status === 'RUNNING' && (
                      <Link href={`/tables/${e.tableId}`} className="small">
                        Watch
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Blind levels</h2>
        <table className="list small" data-testid="levels">
          <thead>
            <tr>
              <th>Level</th>
              <th className="num">Small blind</th>
              <th className="num">Big blind</th>
            </tr>
          </thead>
          <tbody>
            {t.levels.map((l) => (
              <tr
                key={l.level}
                style={l.level === t.currentLevel?.level ? { fontWeight: 700 } : undefined}
              >
                <td>{l.level}</td>
                <td className="num">{chips(l.smallBlind)}</td>
                <td className="num">{chips(l.bigBlind)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Later levels keep doubling.</p>
      </div>
    </div>
  );
}

export default function TournamentPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  return (
    <main className="content">
      <RequireAuth>
        <TournamentView key={tournamentId} id={tournamentId} />
      </RequireAuth>
    </main>
  );
}
