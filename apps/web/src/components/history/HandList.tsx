'use client';

import Link from 'next/link';
import { PlayingCard } from '@/components/PlayingCard';
import { chips } from '@/lib/format';
import type { HandSummaryRecord } from '@/lib/types';

interface Props {
  hands: HandSummaryRecord[];
  /** Show the viewer's result column (my history). */
  showResult: boolean;
}

export function HandList({ hands, showResult }: Props) {
  if (hands.length === 0) return <p className="muted">No hands yet.</p>;
  return (
    <table className="list" data-testid="hand-list">
      <thead>
        <tr>
          <th>When</th>
          <th>Table</th>
          <th>Hand</th>
          <th>Board</th>
          <th className="num">Pot</th>
          {showResult && <th className="num">Result</th>}
        </tr>
      </thead>
      <tbody>
        {hands.map((h) => (
          <tr key={h.id}>
            <td className="small">{new Date(h.endedAt).toLocaleString()}</td>
            <td>
              {h.tableName}
              <div className="muted small">
                {h.clubName} · {chips(h.smallBlind)}/{chips(h.bigBlind)}
              </div>
            </td>
            <td>
              <Link href={`/hands/${h.id}`}>#{h.handNo}</Link>
              {h.status === 'VOIDED' && (
                <>
                  {' '}
                  <span className="badge yellow">VOIDED</span>
                </>
              )}
            </td>
            <td>
              <div className="row" style={{ gap: 3 }}>
                {h.board.length === 0 ? (
                  <span className="muted small">—</span>
                ) : (
                  h.board.map((c) => <PlayingCard key={c} card={c} small />)
                )}
              </div>
            </td>
            <td className="num">{chips(h.pot)}</td>
            {showResult && (
              <td
                className="num"
                style={{ color: (h.myNet ?? 0) >= 0 ? '#7ee787' : '#ff7b72' }}
                data-testid="hand-result"
              >
                {h.myNet === null ? '—' : `${h.myNet > 0 ? '+' : ''}${chips(h.myNet)}`}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
