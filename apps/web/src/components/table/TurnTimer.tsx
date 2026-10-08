'use client';

import { useEffect, useState } from 'react';

/**
 * Countdown bar for the acting seat (deadline already on the local clock).
 * While the actor's time bank runs it changes color and counts seconds.
 */
export function TurnTimer({
  deadlineAt,
  totalMs,
  bank = false,
}: {
  deadlineAt: number;
  totalMs: number;
  bank?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadlineAt]);
  const remaining = Math.max(0, deadlineAt - now);
  const pct = totalMs > 0 ? Math.min(100, (remaining / totalMs) * 100) : 0;
  const seconds = Math.ceil(remaining / 1000);
  return (
    <>
      <div
        className={`timer${bank ? ' bank' : ''}${remaining < 5_000 ? ' urgent' : ''}`}
        role="timer"
        aria-label={bank ? `Time bank: ${seconds} seconds left` : `${seconds} seconds left`}
        data-testid="turn-timer"
      >
        <div style={{ width: `${pct}%` }} />
      </div>
      {bank && (
        <div className="timer-bank-label" data-testid="time-bank">
          Time bank {seconds}s
        </div>
      )}
    </>
  );
}
