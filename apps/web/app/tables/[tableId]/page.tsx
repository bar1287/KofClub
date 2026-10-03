'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PlayingCard } from '@/components/PlayingCard';
import { RequireAuth } from '@/components/RequireAuth';
import { ActionBar } from '@/components/table/ActionBar';
import { ActionLog } from '@/components/table/ActionLog';
import { BuyInDialog } from '@/components/table/BuyInDialog';
import { ConnectionBadge } from '@/components/table/ConnectionBadge';
import { PokerTable } from '@/components/table/PokerTable';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { chips } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTable } from '@/lib/table/useTable';

function TableRoom({ tableId }: { tableId: string }) {
  const { ep } = useSession();
  const { state, connection, busy, error, clearError, send, markLeaving } = useTable(tableId);
  const [buyInSeat, setBuyInSeat] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [httpError, setHttpError] = useState<string | null>(null);

  const live = connection === 'open' && state.ready && !state.stale;
  const me = state.seats[state.mySeat];
  const table = state.table;

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
        {table && (
          <Link href={`/clubs/${table.clubId}`} className="small">
            ← Lobby
          </Link>
        )}
        <h1 style={{ margin: 0 }} data-testid="table-name">
          {table?.name}
        </h1>
        {table && (
          <span className="muted small">
            NLHE · Blinds {chips(table.smallBlind)}/{chips(table.bigBlind)}
          </span>
        )}
        <ConnectionBadge status={connection} syncing={state.stale} />
        <span className="spacer" />
        {me && (
          <>
            <button
              className="btn small"
              disabled={!live || busy}
              onClick={() => void send({ kind: me.sittingOut ? 'SIT_IN' : 'SIT_OUT' })}
              data-testid="sit-out-toggle"
            >
              {me.sittingOut ? 'Sit in' : 'Sit out'}
            </button>
            <button className="btn small danger" disabled={me.leaving} onClick={() => void leave()}>
              {me.leaving ? 'Leaving after hand' : 'Leave table'}
            </button>
          </>
        )}
      </div>

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
            onSit={!me && live && table?.status === 'OPEN' ? setBuyInSeat : undefined}
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
        <TableRoom tableId={tableId} />
      </RequireAuth>
    </main>
  );
}
