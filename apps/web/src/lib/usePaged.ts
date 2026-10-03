'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from './api/client';

interface PageLike<T> {
  items: T[];
  nextCursor: string | null;
}

/** Keyset-paginated list with "load more" (cursor from the previous page). */
export function usePaged<T>(fetchPage: (cursor: string | null) => Promise<PageLike<T>>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (from: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await fetchPage(from);
        setItems((prev) => (from && prev ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return {
    items,
    error,
    loading,
    hasMore: cursor !== null,
    loadMore: () => void load(cursor),
    reload: () => void load(null),
  };
}
