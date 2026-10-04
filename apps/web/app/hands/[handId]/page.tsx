'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PlayingCard } from '@/components/PlayingCard';
import { RequireAuth } from '@/components/RequireAuth';
import { errorMessage } from '@/lib/api/client';
import { chips } from '@/lib/format';
import { gameLabel } from '@/lib/games';
import { useSession } from '@/lib/session';
import { describeEvent } from '@/lib/table/describe';
import type { HandDetail } from '@/lib/types';

const ROLE_NOTE: Record<HandDetail['viewerRole'], string> = {
  PARTICIPANT: 'You played this hand.',
  CLUB_STAFF: 'Club staff view: public record only — players’ unrevealed cards are never shown.',
  PLATFORM_ADMIN: 'Platform oversight view: public record only.',
};

function HandView({ handId }: { handId: string }) {
  const { ep, user } = useSession();
  const [hand, setHand] = useState<HandDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ep.hand(handId)
      .then(setHand)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [ep, handId]);

  if (error) return <ErrorAlert error={error} />;
  if (!hand) return <p className="muted">Loading…</p>;

  const names = new Map(hand.players.map((p) => [p.seat, p.username]));
  const name = (seat: number) => names.get(seat) ?? `Seat ${seat}`;
  const lines = hand.events
    .map((e) => ({ seq: e.seq, text: describeEvent(e.event, name) }))
    .filter((l): l is { seq: number; text: string } => l.text !== null);

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }} data-testid="hand-title">
          Hand #{hand.handNo}
        </h1>
        {hand.status === 'VOIDED' && <span className="badge yellow">VOIDED</span>}
        <span className="muted">
          {hand.tableName} · {hand.clubName} · {gameLabel(hand.gameType)} · Blinds{' '}
          {chips(hand.smallBlind)}/{chips(hand.bigBlind)}
        </span>
        <span className="spacer" />
        <Link href="/hands" className="small">
          ← My hands
        </Link>
      </div>
      <p className="muted small">
        {new Date(hand.startedAt).toLocaleString()} · {ROLE_NOTE[hand.viewerRole]}
        {hand.voidReason && ` Voided: ${hand.voidReason}; all stacks were restored.`}
      </p>

      <div className="grid-2">
        <div className="panel">
          <h2>Board</h2>
          <div className="row" style={{ gap: 6 }} data-testid="hand-board">
            {hand.board.length === 0 ? (
              <span className="muted">No community cards (the hand ended before the flop).</span>
            ) : (
              hand.board.map((c) => <PlayingCard key={c} card={c} />)
            )}
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>
            Pot {chips(hand.pot)}
          </p>
        </div>
        {hand.viewerRole === 'PARTICIPANT' && (
          <div className="panel">
            <h2>Your cards</h2>
            {hand.myHoleCards ? (
              <div className="row" style={{ gap: 6 }} data-testid="my-hole-cards">
                {hand.myHoleCards.map((c) => (
                  <PlayingCard key={c} card={c} />
                ))}
              </div>
            ) : (
              <p className="muted">Your cards are temporarily unavailable.</p>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Players</h2>
        <table className="list" data-testid="hand-players">
          <thead>
            <tr>
              <th>Seat</th>
              <th>Player</th>
              <th>Shown cards</th>
              <th className="num">Start</th>
              <th className="num">Result</th>
            </tr>
          </thead>
          <tbody>
            {hand.players.map((p) => (
              <tr key={p.seat}>
                <td>
                  {p.seat}
                  {p.seat === hand.buttonSeat && <span className="badge"> D</span>}
                </td>
                <td>
                  {p.username}
                  {p.userId === user?.id && <span className="muted small"> (you)</span>}
                  {p.folded && <span className="muted small"> · folded</span>}
                </td>
                <td>
                  <div className="row" style={{ gap: 3 }}>
                    {p.shownCards ? (
                      p.shownCards.map((c) => <PlayingCard key={c} card={c} small />)
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </div>
                </td>
                <td className="num">{chips(p.startingStack)}</td>
                <td className="num" style={{ color: (p.net ?? 0) >= 0 ? '#7ee787' : '#ff7b72' }}>
                  {p.net === null ? '—' : `${p.net > 0 ? '+' : ''}${chips(p.net)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Actions</h2>
        <ol
          className="log"
          data-testid="hand-actions"
          style={{ maxHeight: 'none', paddingLeft: 36 }}
        >
          {lines.map((l) => (
            <li key={l.seq}>{l.text}</li>
          ))}
        </ol>
      </div>
      <p className="muted small mono">Deck commitment {hand.deckCommitment}</p>
    </div>
  );
}

export default function HandPage() {
  const { handId } = useParams<{ handId: string }>();
  return (
    <main className="content">
      <RequireAuth>
        <HandView handId={handId} />
      </RequireAuth>
    </main>
  );
}
