'use client';

import { useEffect, useRef } from 'react';
import type { LogEntry } from '@/lib/table/state';

export function ActionLog({ entries }: { entries: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [entries.length]);
  return (
    <div className="log" ref={ref} data-testid="action-log">
      {entries.length === 0 ? (
        <span className="muted">No actions yet.</span>
      ) : (
        entries.map((e, i) => <div key={`${e.seq}-${i}`}>{e.text}</div>)
      )}
    </div>
  );
}
