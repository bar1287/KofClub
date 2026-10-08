'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PlayingCard } from '@/components/PlayingCard';
import { RequireAuth } from '@/components/RequireAuth';
import { ActionBar } from '@/components/table/ActionBar';
import { ActionLog } from '@/components/table/ActionLog';
import { BuyInDialog } from '@/components/table/BuyInDialog';
import { TableChat } from '@/components/table/TableChat';
import { TopUpDialog } from '@/components/table/TopUpDialog';
import { ConnectionBadge } from '@/components/table/ConnectionBadge';
import { gameLabel } from '@/lib/games';
import { PokerTable } from '@/components/table/PokerTable';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { chips, ordinal } from '@/lib/format';
import { formatCountdown, useNow } from '@/lib/time';
import { useSession } from '@/lib/session';
import { FOLLOW_INTERVAL_MS, followDecision } from '@/lib/table/follow';
import { useTable } from '@/lib/table/useTable';
import { useTableChat } from '@/lib/table/useTableChat';

function TableRoom({ tableId }: { tableId: string }) {
  const { ep, user } = useSession();
  const { state, connection, busy, error, clearError, send, markLeaving, noteTopUp } =
    useTable(tableId);
  const chat = useTableChat(tableId, connection);
  const [buyInSeat, setBuyInSeat] = useState<number | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [httpError, setHttpError] = useState<string | null>(null);

  const live = connection === 'open' && state.ready && !state.stale;
  const me = state.seats[state.mySeat];
  const table = state.table;
  const tournament = table?.tournament;
  const router = useRouter();
  const now = useNow();

  // Tournament balancing moved the viewer: follow them to their new table.
  const departure = state.departure;
  useEffect(() => {
    if (departure?.reason === 'MOVED' && departure.toTableId) {
      router.replace(`/tables/${departure.toTableId}`);
    }
  }, [departure, router]);
  // An unseated tournament player may have missed that move (it happened
  // before this page subscribed): ask the tournament where they play.
  const tournamentId = tournament?.tournamentId;
  const unseated = live && tournament?.status === 'RUNNING' && !me && !departure;
  useEffect(() => {
    if (!unseated || !tournamentId) return;
    let done = false;
    const timer = setInterval(() => {
      void ep
        .tournament(tournamentId)
        .then((t) => {
          const next = followDecision(t, tableId);
          if (done || next === 'wait') return;
          done = true;
          clearInterval(timer);
          if (next !== 'stop') router.replace(`/tables/${next.go}`);
        })
        .catch(() => undefined);
    }, FOLLOW_INTERVAL_MS);
    return () => {
      done = true;
      clearInterval(timer);
    };
  }, [unseated, tournamentId, tableId, ep, router]);

  async function leave() {
    setHttpError(null);
    try {
      const res = await ep.leaveTable(tableId, newIdempotencyKey());
      if (res.status === 'LEAVING_AFTER_HAND') {
        markLeaving(true);
        setNotice('You will leave the table when this hand ends.');
      } else {
        setNotice(`You left the table. ${chips(res.cashOut)} chips returned to your wallet.`);
      }
    } catch (err) {
      setHttpError(errorMessage(err));
    }
  }

  if (!state.ready) {
    return (
      <div className="stack">
        <ConnectionBadge status={connection} syncing />
        {error ? <ErrorAlert error={error.message} /> : <p className="muted">Joining table…</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="table-header">
        {table && !tournament && (
          <Link href={`/clubs/${table.clubId}`} className="small">
            ← Lobby
          </Link>
        )}
        {tournament && (
          <Link href={`/tournaments/${tournament.tournamentId}`} className="small">
            ← Tournament
          </Link>
        )}
        <h1 style={{ margin: 0 }} data-testid="table-name">
          {table?.name}
        </h1>
        {table && !tournament && (
          <span className="muted small" data-testid="table-game">
            {gameLabel(table.gameType)} · Blinds {chips(table.smallBlind)}/{chips(table.bigBlind)}
          </span>
        )}
        {table && tournament && (
          <span className="muted small" data-testid="table-game">
            {gameLabel(table.gameType)} · Level {tournament.level} · Blinds{' '}
            {chips(tournament.smallBlind)}/{chips(tournament.bigBlind)}
            {tournament.status === 'RUNNING' && (
              <span data-testid="level-countdown">
                {' '}
                · next {chips(tournament.nextSmallBlind)}/{chips(tournament.nextBigBlind)} in{' '}
                {formatCountdown(Date.parse(tournament.levelEndsAt) - now)}
              </span>
            )}
          </span>
        )}
        <ConnectionBadge status={connection} syncing={state.stale} />
        <span className="spacer" />
        {me && (
          <>
            {!tournament && (
              <button
                className="btn small"
                disabled={!live || table?.status !== 'OPEN'}
                onClick={() => setTopUpOpen(true)}
                data-testid="add-chips"
              >
                {me.stack === 0 ? 'Re-buy' : 'Add chips'}
              </button>
            )}
            <button
              className="btn small"
              disabled={!live || busy || (me.sittingOut && me.stack === 0)}
              onClick={() => void send({ kind: me.sittingOut ? 'SIT_IN' : 'SIT_OUT' })}
              data-testid="sit-out-toggle"
            >
              {me.sittingOut ? 'Sit in' : me.inHand ? 'Sit out next hand' : 'Sit out'}
            </button>
            {!tournament && (
              <button
                className="btn small danger"
                disabled={me.leaving}
                onClick={() => void leave()}
              >
                {me.leaving ? 'Leaving after hand' : 'Leave table'}
              </button>
            )}
          </>
        )}
      </div>

      {tournament && departure && departure.reason !== 'MOVED' && (
        <div className="alert info" style={{ marginBottom: 12 }} data-testid="tournament-result">
          {departure.place === 1
            ? 'You won the tournament!'
            : departure.place
              ? `You finished in ${ordinal(departure.place)} place.`
              : 'Your tournament is over.'}{' '}
          <Link href={`/tournaments/${tournament.tournamentId}`}>See the results</Link>
        </div>
      )}
      {departure?.reason === 'MOVED' && (
        <div className="alert info" style={{ marginBottom: 12 }}>
          You were moved to another table…
        </div>
      )}
      {me?.bustedUntil && me.stack === 0 && (
        <div className="alert info row" style={{ marginBottom: 12 }} data-testid="busted">
          <span>
            You are out of chips. Re-buy within {formatCountdown(Math.max(0, me.bustedUntil - now))}{' '}
            to keep your seat.
          </span>
          <button className="btn small primary" onClick={() => setTopUpOpen(true)}>
            Re-buy
          </button>
        </div>
      )}
      {state.myPendingTopUp > 0 && (
        <div className="alert info" style={{ marginBottom: 12 }} data-testid="pending-top-up">
          {chips(state.myPendingTopUp)} chips will be added when this hand ends.
        </div>
      )}
      {table?.status === 'CLOSED' && (
        <div className="alert info" style={{ marginBottom: 12 }} data-testid="table-closed">
          This table is closed. No new hands are dealt and every seat is cashed out to the club
          wallet when the current hand ends.
        </div>
      )}
      <div className="table-page">
        <div>
          <PokerTable
            state={state}
            onSit={
              !me && !tournament && live && table?.status === 'OPEN' ? setBuyInSeat : undefined
            }
            reactions={chat.reactions}
          />
          {me && <ActionBar state={state} enabled={live} busy={busy} send={send} />}
          <div className="stack" style={{ marginTop: 12 }}>
            {error && (
              <div className="alert error" role="alert" onClick={clearError}>
                {error.message}
              </div>
            )}
            <ErrorAlert error={httpError} />
            {notice && <div className="alert info">{notice}</div>}
          </div>
        </div>
        <aside className="stack">
          {me && state.holeCards.length > 0 && (
            <div className="panel">
              <h3>Your hand</h3>
              <div className="row" data-testid="hole-cards">
                {state.holeCards.map((c) => (
                  <PlayingCard key={c} card={c} />
                ))}
              </div>
            </div>
          )}
          {state.lastHand && (
            <div className="panel" data-testid="last-hand">
              <h3>
                <Link href={`/hands/${state.lastHand.handId}`}>Hand #{state.lastHand.handNo}</Link>
              </h3>
              <table className="list small">
                <tbody>
                  {state.lastHand.results.map((r) => (
                    <tr key={r.seat}>
                      <td>{state.seats[r.seat]?.username ?? `Seat ${r.seat}`}</td>
                      <td className="num" style={{ color: r.net >= 0 ? '#7ee787' : '#ff7b72' }}>
                        {r.net > 0 ? '+' : ''}
                        {chips(r.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <TableChat chat={chat} myUserId={user?.id ?? null} live={connection === 'open'} />
          <div className="panel">
            <h3>Table log</h3>
            <ActionLog entries={state.log} />
          </div>
          {state.hand && (
            <p className="muted small mono" title="SHA-256 commitment to the shuffled deck">
              Hand #{state.hand.handNo} · deck {state.hand.deckCommitment.slice(0, 16)}…
            </p>
          )}
        </aside>
      </div>

      {topUpOpen && table && me && (
        <TopUpDialog
          tableId={tableId}
          table={table}
          stack={me.stack}
          pending={state.myPendingTopUp}
          autoTopUpTo={state.myAutoTopUpTo}
          onApplied={({ pending }) => noteTopUp({ pending })}
          onAutoTopUp={(to) => noteTopUp({ autoTopUpTo: to })}
          onClose={() => setTopUpOpen(false)}
        />
      )}
      {buyInSeat !== null && table && (
        <BuyInDialog
          tableId={tableId}
          table={table}
          seatNo={buyInSeat}
          onClose={() => setBuyInSeat(null)}
        />
      )}
    </div>
  );
}

export default function TablePage() {
  const { tableId } = useParams<{ tableId: string }>();
  return (
    <main className="content wide">
      <RequireAuth>
        <TableRoom key={tableId} tableId={tableId} />
      </RequireAuth>
    </main>
  );
}
