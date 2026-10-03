'use client';

import { useCallback, useEffect, useState } from 'react';
import { newIdempotencyKey } from '@/lib/api/client';
import { chips } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Club, LedgerSummary } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

/**
 * Club chip administration: treasury summary, member balances with grants
 * and deductions, and the immutable transaction log with reversals.
 * Virtual chips only (ADR-006) — nothing here can move money.
 */
export function ChipsPanel({ club }: { club: Club }) {
  const { ep } = useSession();
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const balancesPage = useCallback(
    (c: string | null) => ep.ledgerBalances(club.id, c),
    [ep, club.id],
  );
  const txPage = useCallback(
    (c: string | null) => ep.ledgerTransactions(club.id, c),
    [ep, club.id],
  );
  const balances = usePaged(balancesPage);
  const txs = usePaged(txPage);
  const { busy, error, notice, run } = useAction();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // One idempotency key per pending movement, so retries never move chips twice.
  const [keys, setKeys] = useState<Record<string, string>>({});

  const loadSummary = useCallback(
    async () => setSummary(await ep.ledgerSummary(club.id)),
    [ep, club.id],
  );
  useEffect(() => {
    void run(loadSummary);
  }, [run, loadSummary]);

  const refresh = () => {
    void loadSummary();
    balances.reload();
    txs.reload();
  };

  function move(kind: 'grant' | 'deduct', userId: string, username: string) {
    const amount = Number(amounts[userId]);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      void run(async () => {
        throw new Error('Enter a whole, positive number of chips.');
      });
      return;
    }
    const slot = `${kind}:${userId}:${amount}`;
    const key = keys[slot] ?? newIdempotencyKey();
    setKeys({ ...keys, [slot]: key });
    void run(async () => {
      if (kind === 'grant') await ep.grantChips(club.id, { userId, amount }, key);
      else await ep.deductChips(club.id, { userId, amount }, key);
      setKeys((k) => {
        const next = { ...k };
        delete next[slot];
        return next;
      });
      setAmounts({ ...amounts, [userId]: '' });
      refresh();
      return `${kind === 'grant' ? 'Granted' : 'Deducted'} ${chips(amount)} chips ${kind === 'grant' ? 'to' : 'from'} ${username}.`;
    });
  }

  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Chips &amp; ledger</h2>
      {summary && (
        <div className="row" data-testid="ledger-summary">
          <Stat label="Issued by the club" value={summary.issued} />
          <Stat label="In member wallets" value={summary.inWallets} />
          <Stat label="At tables" value={summary.atTables} />
          <Stat label="Holders" value={summary.holders} plain />
        </div>
      )}
      <Feedback error={error} notice={notice} />
      <div className="panel" style={{ background: 'var(--panel-2)' }}>
        <h3>Balances</h3>
        <table className="list" data-testid="ledger-balances">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">Wallet</th>
              <th className="num">At tables</th>
              <th>Move chips</th>
            </tr>
          </thead>
          <tbody>
            {(balances.items ?? []).map((b) => (
              <tr key={b.userId} data-member={b.username}>
                <td>{b.username}</td>
                <td className="num">{chips(b.walletBalance)}</td>
                <td className="num">{chips(b.tableBalance)}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      aria-label={`Chips for ${b.username}`}
                      inputMode="numeric"
                      style={{ width: 100 }}
                      value={amounts[b.userId] ?? ''}
                      onChange={(e) => setAmounts({ ...amounts, [b.userId]: e.target.value })}
                    />
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => move('grant', b.userId, b.username)}
                    >
                      Grant
                    </button>
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => move('deduct', b.userId, b.username)}
                    >
                      Deduct
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {balances.hasMore && (
          <button className="btn small" onClick={balances.loadMore}>
            Load more
          </button>
        )}
        <p className="muted small">
          Only chips in a member&apos;s wallet can be deducted; chips at a table return to the
          wallet when the player leaves.
        </p>
      </div>
      <div className="panel" style={{ background: 'var(--panel-2)' }}>
        <h3>Transactions</h3>
        <table className="list small" data-testid="ledger-transactions">
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>By</th>
              <th>Movements</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(txs.items ?? []).map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.createdAt).toLocaleString()}</td>
                <td>
                  <span className="badge">{t.kind}</span>
                </td>
                <td>{t.actorUsername ?? t.actorType}</td>
                <td>
                  {t.entries
                    .filter((e) => e.accountKind !== 'CLUB_TREASURY')
                    .map(
                      (e) =>
                        `${e.ownerUsername ?? '—'} ${e.amount > 0 ? '+' : ''}${chips(e.amount)}${e.accountKind === 'TABLE_STACK' ? ' (table)' : ''}`,
                    )
                    .join(', ')}
                </td>
                <td className="num">
                  {(t.kind === 'CLUB_GRANT' || t.kind === 'CLUB_DEDUCTION') && (
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => {
                        const note = window.prompt('Reason for reversing this transaction?');
                        if (!note) return;
                        void run(async () => {
                          await ep.reverseTransaction(club.id, t.id, note);
                          refresh();
                          return 'Transaction reversed with a compensating entry.';
                        });
                      }}
                    >
                      Reverse
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {txs.hasMore && (
          <button className="btn small" onClick={txs.loadMore}>
            Load more
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, plain }: { label: string; value: number; plain?: boolean }) {
  return (
    <div className="panel" style={{ flex: '1 1 150px', background: 'var(--panel-2)' }}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{plain ? value : chips(value)}</div>
    </div>
  );
}
