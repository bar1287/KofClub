'use client';

import { useCallback, useEffect, useState } from 'react';
import { HandList } from '@/components/history/HandList';
import { useSession } from '@/lib/session';
import type { Club, Table } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

export function HandsPanel({ club }: { club: Club }) {
  const { ep } = useSession();
  const [tables, setTables] = useState<Table[]>([]);
  const [tableId, setTableId] = useState('');
  useEffect(() => {
    ep.tables(club.id)
      .then(setTables)
      .catch(() => setTables([]));
  }, [ep, club.id]);
  const fetchPage = useCallback(
    (cursor: string | null) => ep.clubHands(club.id, { tableId: tableId || undefined, cursor }),
    [ep, club.id, tableId],
  );
  const { items, error, hasMore, loadMore } = usePaged(fetchPage);
  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Hands</h2>
        <span className="spacer" />
        <select aria-label="Table" value={tableId} onChange={(e) => setTableId(e.target.value)}>
          <option value="">All tables</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">
        Public record only: unrevealed hole cards are never shown to staff (ADR-008).
      </p>
      {error && <div className="alert error">{error}</div>}
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <HandList hands={items} showResult={false} />
      )}
      {hasMore && (
        <button className="btn" onClick={loadMore}>
          Load more
        </button>
      )}
    </div>
  );
}
