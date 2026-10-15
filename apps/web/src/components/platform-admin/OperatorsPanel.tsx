'use client';

import { useCallback, useState } from 'react';
import { Feedback } from '@/components/club-admin/Feedback';
import { useAction } from '@/components/club-admin/useAction';
import { useSession } from '@/lib/session';
import type { Operator, OperatorStatus } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

type Target = 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

/** What an administrator can do from each status (mirrors the server). */
const ACTIONS: Record<OperatorStatus, { to: Target; label: string; danger?: boolean }[]> = {
  PENDING: [
    { to: 'ACTIVE', label: 'Approve' },
    { to: 'REJECTED', label: 'Reject', danger: true },
  ],
  ACTIVE: [{ to: 'SUSPENDED', label: 'Suspend', danger: true }],
  SUSPENDED: [
    { to: 'ACTIVE', label: 'Reinstate' },
    { to: 'REJECTED', label: 'Reject', danger: true },
  ],
  REJECTED: [{ to: 'ACTIVE', label: 'Approve' }],
};

/**
 * Operator review (ADR-019). Approving connects the operator's bot to this
 * service; suspending disconnects it and signs everyone in that world out.
 */
export function OperatorsPanel() {
  const { ep } = useSession();
  const [status, setStatus] = useState<OperatorStatus | ''>('PENDING');
  const fetchPage = useCallback((c: string | null) => ep.adminOperators(status, c), [ep, status]);
  const { items, hasMore, loadMore, reload } = usePaged<Operator>(fetchPage);
  const { busy, error, notice, run } = useAction();

  function change(o: Operator, to: Target, label: string) {
    const reason = window.prompt(`${label} ${o.name} (@${o.botUsername})? Reason:`);
    if (!reason || reason.trim().length < 3) return;
    void run(async () => {
      await ep.adminSetOperatorStatus(o.id, to, reason.trim());
      reload();
      return `${o.name}: ${to.toLowerCase()}.`;
    });
  }

  return (
    <div className="stack">
      <div className="row">
        <select
          aria-label="Operator status"
          value={status}
          onChange={(e) => setStatus(e.target.value as OperatorStatus | '')}
        >
          <option value="PENDING">Waiting for approval</option>
          <option value="ACTIVE">Live</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </select>
      </div>
      <Feedback error={error} notice={notice} />
      <table className="list small" data-testid="admin-operators">
        <thead>
          <tr>
            <th>Operator</th>
            <th>Bot</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Registered</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((o) => (
            <tr key={o.id}>
              <td>
                {o.name} <span className="muted mono">{o.slug}</span>
              </td>
              <td>
                <a href={`https://t.me/${o.botUsername}`} target="_blank" rel="noreferrer">
                  @{o.botUsername}
                </a>
              </td>
              <td>{o.ownerUsername}</td>
              <td>
                <span className="badge">{o.status}</span>
                {o.statusReason && <div className="muted">{o.statusReason}</div>}
              </td>
              <td>{new Date(o.createdAt).toLocaleString()}</td>
              <td>
                <div className="row" style={{ gap: 4 }}>
                  {ACTIONS[o.status].map((a) => (
                    <button
                      key={a.to}
                      className={`btn small${a.danger ? ' danger' : ''}`}
                      disabled={busy}
                      onClick={() => change(o, a.to, a.label)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items?.length === 0 && <p className="muted">No operators.</p>}
      {hasMore && (
        <button className="btn" onClick={loadMore}>
          Load more
        </button>
      )}
    </div>
  );
}
