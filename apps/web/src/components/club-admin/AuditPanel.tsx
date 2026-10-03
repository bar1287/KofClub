'use client';

import { useCallback } from 'react';
import { useSession } from '@/lib/session';
import type { Club } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

function summarize(v: Record<string, unknown> | null): string {
  if (!v) return '';
  return Object.entries(v)
    .map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : String(x)}`)
    .join(', ');
}

export function AuditPanel({ club }: { club: Club }) {
  const { ep } = useSession();
  const fetchPage = useCallback(
    (cursor: string | null) => ep.auditLog(club.id, cursor),
    [ep, club.id],
  );
  const { items, error, hasMore, loadMore } = usePaged(fetchPage);
  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Audit log</h2>
      <p className="muted small">Append-only record of privileged actions in this club.</p>
      {error && <div className="alert error">{error}</div>}
      <table className="list small" data-testid="audit-log">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Change</th>
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
              <td className="mono" style={{ wordBreak: 'break-word' }}>
                {a.before && <div className="muted">before {summarize(a.before)}</div>}
                {a.after && <div>after {summarize(a.after)}</div>}
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
