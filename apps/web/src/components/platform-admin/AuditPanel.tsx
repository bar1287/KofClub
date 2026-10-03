'use client';

import { useCallback, useState } from 'react';
import { useSession } from '@/lib/session';
import { usePaged } from '@/lib/usePaged';

export function PlatformAuditPanel() {
  const { ep } = useSession();
  const [action, setAction] = useState('');
  const [filter, setFilter] = useState('');
  const fetchPage = useCallback(
    (c: string | null) => ep.adminAudit({ action: filter || undefined }, c),
    [ep, filter],
  );
  const { items, error, hasMore, loadMore } = usePaged(fetchPage);
  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(action.trim().toUpperCase());
        }}
      >
        <input
          aria-label="Action"
          placeholder="Action, e.g. USER_SUSPENDED"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn" type="submit">
          Filter
        </button>
      </form>
      {error && <div className="alert error">{error}</div>}
      <table className="list small" data-testid="admin-audit">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Object</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.createdAt).toLocaleString()}</td>
              <td>{a.actorUsername ?? 'system'}</td>
              <td>
                <span className="badge">{a.action}</span>
              </td>
              <td className="mono">
                {a.objectType}:{a.objectId?.slice(0, 8)}
              </td>
              <td className="mono" style={{ wordBreak: 'break-word' }}>
                {a.after ? JSON.stringify(a.after) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && (
        <button className="btn" onClick={loadMore}>
          Load more
        </button>
      )}
    </div>
  );
}
