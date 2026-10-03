'use client';

import { useCallback } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { HandList } from '@/components/history/HandList';
import { RequireAuth } from '@/components/RequireAuth';
import { useSession } from '@/lib/session';
import { usePaged } from '@/lib/usePaged';

function MyHands() {
  const { ep } = useSession();
  const fetchPage = useCallback((cursor: string | null) => ep.myHands(cursor), [ep]);
  const { items, error, loading, hasMore, loadMore } = usePaged(fetchPage);
  return (
    <div className="stack">
      <h1>Hand history</h1>
      <ErrorAlert error={error} />
      <div className="panel">
        {items === null ? <p className="muted">Loading…</p> : <HandList hands={items} showResult />}
        {hasMore && (
          <button className="btn" onClick={loadMore} disabled={loading} style={{ marginTop: 12 }}>
            Load more
          </button>
        )}
      </div>
    </div>
  );
}

export default function HandsPage() {
  return (
    <main className="content">
      <RequireAuth>
        <MyHands />
      </RequireAuth>
    </main>
  );
}
