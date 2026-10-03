'use client';

import { useEffect, useState } from 'react';

/** Countdown bar for the acting seat (deadline already on the local clock). */
export function TurnTimer({ deadlineAt, totalMs }: { deadlineAt: number; totalMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadlineAt]);
  const remaining = Math.max(0, deadlineAt - now);
  const pct = totalMs > 0 ? Math.min(100, (remaining / totalMs) * 100) : 0;
  return (
    <div
      className={`timer${remaining < 5_000 ? ' urgent' : ''}`}
      role="timer"
      aria-label={`${Math.ceil(remaining / 1000)} seconds left`}
      data-testid="turn-timer"
    >
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}
