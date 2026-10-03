'use client';

import { useCallback, useState } from 'react';
import { Feedback } from '@/components/club-admin/Feedback';
import { useAction } from '@/components/club-admin/useAction';
import { useSession } from '@/lib/session';
import type { RiskEvent } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

const DISPOSITIONS = ['DISMISSED', 'CONFIRMED', 'ESCALATED'] as const;

/**
 * Risk-case review queue. A disposition never enforces anything by itself
 * (spec §11): suspensions are separate, explicit actions in the Accounts tab.
 */
export function RiskPanel() {
  const { ep } = useSession();
  const [status, setStatus] = useState<'OPEN' | 'REVIEWED'>('OPEN');
  const fetchPage = useCallback((c: string | null) => ep.adminRisk(status, c), [ep, status]);
  const { items, hasMore, loadMore, reload } = usePaged<RiskEvent>(fetchPage);
  const { busy, error, notice, run } = useAction();

  function review(e: RiskEvent, disposition: (typeof DISPOSITIONS)[number]) {
    const note = window.prompt(`Why ${disposition.toLowerCase()}? (recorded with the case)`);
    if (!note) return;
    void run(async () => {
      await ep.adminReviewRisk(e.id, disposition, note);
      reload();
      return 'Review recorded.';
    });
  }

  return (
    <div className="stack">
      <div className="row">
        <select
          aria-label="Case status"
          value={status}
          onChange={(e) => setStatus(e.target.value as 'OPEN' | 'REVIEWED')}
        >
          <option value="OPEN">Open</option>
          <option value="REVIEWED">Reviewed</option>
        </select>
      </div>
      <Feedback error={error} notice={notice} />
      <table className="list small" data-testid="admin-risk">
        <thead>
          <tr>
            <th>When</th>
            <th>Subject</th>
            <th>Signal</th>
            <th className="num">Score</th>
            <th>Evidence</th>
            <th>{status === 'OPEN' ? 'Review' : 'Outcome'}</th>
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.createdAt).toLocaleString()}</td>
              <td>{e.subjectUsername ?? '—'}</td>
              <td>
                <span
                  className={`badge ${e.severity === 'HIGH' ? 'red' : e.severity === 'MEDIUM' ? 'yellow' : ''}`}
                >
                  {e.severity}
                </span>{' '}
                {e.type}
              </td>
              <td className="num">{e.score}</td>
              <td className="mono" style={{ wordBreak: 'break-word' }}>
                {JSON.stringify(e.evidenceRefs)}
              </td>
              <td>
                {status === 'OPEN' ? (
                  <div className="row" style={{ gap: 4 }}>
                    {DISPOSITIONS.map((d) => (
                      <button
                        key={d}
                        className="btn small"
                        disabled={busy}
                        onClick={() => review(e, d)}
                      >
                        {d.charAt(0) + d.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <span className="badge">{e.disposition}</span> by {e.reviewedByUsername}
                    <div className="muted">{e.reviewNote}</div>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items?.length === 0 && <p className="muted">No cases.</p>}
      {hasMore && (
        <button className="btn" onClick={loadMore}>
          Load more
        </button>
      )}
    </div>
  );
}
