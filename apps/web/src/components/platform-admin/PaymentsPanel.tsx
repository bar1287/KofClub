'use client';

import { useCallback } from 'react';
import { Feedback } from '@/components/club-admin/Feedback';
import { useAction } from '@/components/club-admin/useAction';
import { useSession } from '@/lib/session';
import { paymentLabel, stars } from '@/lib/store';
import type { StarPayment } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

/**
 * Telegram Stars payments (T2, ADR-018). A refund returns the Stars to the
 * payer through Telegram and takes back what the payment bought; it is
 * recorded in the audit log.
 */
export function PaymentsPanel() {
  const { ep } = useSession();
  const fetchPage = useCallback((c: string | null) => ep.adminStarPayments(c), [ep]);
  const { items, hasMore, loadMore, reload } = usePaged<StarPayment>(fetchPage);
  const { busy, error, notice, run } = useAction();

  function refund(p: StarPayment) {
    const reason = window.prompt(
      `Refund ${stars(p.stars)} to ${p.username ?? 'the payer'}? Reason:`,
    );
    if (!reason || reason.trim().length < 3) return;
    void run(async () => {
      await ep.adminRefundStarPayment(p.id, reason.trim());
      reload();
      return 'Refunded.';
    });
  }

  return (
    <div className="stack">
      <Feedback error={error} notice={notice} />
      <table className="list small" data-testid="admin-payments">
        <thead>
          <tr>
            <th>Paid</th>
            <th>Player</th>
            <th>Item</th>
            <th className="num">Stars</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((p) => (
            <tr key={p.id}>
              <td>{new Date(p.paidAt).toLocaleString()}</td>
              <td>{p.username ?? '—'}</td>
              <td>{paymentLabel(p)}</td>
              <td className="num">{stars(p.stars)}</td>
              <td>
                {p.refundedAt ? (
                  <span className="badge" title={p.refundReason ?? undefined}>
                    Refunded
                  </span>
                ) : (
                  <button className="btn small danger" disabled={busy} onClick={() => refund(p)}>
                    Refund
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items?.length === 0 && <p className="muted">No payments.</p>}
      {hasMore && (
        <button className="btn" onClick={loadMore}>
          Load more
        </button>
      )}
    </div>
  );
}
