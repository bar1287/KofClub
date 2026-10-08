'use client';

import { useCallback, useState } from 'react';
import { useSession } from '@/lib/session';
import type { ChatReport, ChatReportStatus, Club } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

const STATUSES: Array<{ id: ChatReportStatus; label: string }> = [
  { id: 'OPEN', label: 'Open' },
  { id: 'HIDDEN', label: 'Hidden' },
  { id: 'DISMISSED', label: 'Dismissed' },
];

/** Chat messages players reported (ADMIN+): hide the message or dismiss the report. */
export function ChatReportsPanel({ club }: { club: Club }) {
  const { ep } = useSession();
  const [status, setStatus] = useState<ChatReportStatus>('OPEN');
  const fetchPage = useCallback(
    (cursor: string | null) => ep.chatReports(club.id, status, cursor),
    [ep, club.id, status],
  );
  const { items, error: loadError, hasMore, loadMore, reload } = usePaged(fetchPage);
  const { busy, error, notice, run } = useAction();

  function resolve(report: ChatReport, action: 'HIDE' | 'DISMISS') {
    void run(async () => {
      await ep.resolveChatReport(club.id, report.id, action);
      reload();
      return action === 'HIDE'
        ? `The message from ${report.reportedUsername} was hidden.`
        : 'Report dismissed.';
    });
  }

  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Chat reports</h2>
        <span className="spacer" />
        <select
          aria-label="Report status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ChatReportStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">
        Hiding removes the message from the table&apos;s chat for everyone. To stop a player
        chatting, ban them in the Members tab or turn chat off in Settings.
      </p>
      <Feedback error={error ?? loadError} notice={notice} />
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">No reports.</p>
      ) : (
        <table className="list small" data-testid="chat-reports">
          <thead>
            <tr>
              <th>Reported</th>
              <th>Message</th>
              <th>Reason</th>
              <th>By</th>
              <th>When</th>
              {status === 'OPEN' && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{r.reportedUsername}</td>
                <td style={{ overflowWrap: 'anywhere' }}>{r.text}</td>
                <td>{r.reason ?? '—'}</td>
                <td>{r.reporterUsername}</td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                {status === 'OPEN' && (
                  <td className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <button
                      className="btn small danger"
                      disabled={busy}
                      onClick={() => resolve(r, 'HIDE')}
                    >
                      Hide message
                    </button>
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => resolve(r, 'DISMISS')}
                    >
                      Dismiss
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore && (
        <button className="btn" onClick={loadMore}>
          Load more
        </button>
      )}
    </div>
  );
}
