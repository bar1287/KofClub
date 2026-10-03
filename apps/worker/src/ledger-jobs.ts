import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { Gauge, Registry } from 'prom-client';
import type { Job } from './jobs';

/**
 * Continuously verifies ledger invariants (spec §14 "ledger imbalance
 * assertion failures = 0"): unbalanced transactions, projection drift,
 * clubs not summing to zero, negative balances. Any violation is logged at
 * error level and exported as a gauge so alerting can page on-call.
 */
export function ledgerInvariantCheck(pool: Pool, logger: Logger, registry: Registry): Job {
  const gauge = new Gauge({
    name: 'ledger_invariant_violations',
    help: 'Rows in ledger_invariant_violations (must be 0).',
    labelNames: ['violation'] as const,
    registers: [registry],
  });
  const kinds = [
    'UNBALANCED_TRANSACTION',
    'PROJECTION_MISMATCH',
    'CLUB_NOT_ZERO_SUM',
    'NEGATIVE_BALANCE',
  ];
  return {
    name: 'ledger-invariant-check',
    async run() {
      const res = await pool.query<{ violation: string; subject: string; amount: string }>(
        'SELECT violation, subject, amount::text FROM ledger_invariant_violations LIMIT 100',
      );
      for (const k of kinds)
        gauge.set({ violation: k }, res.rows.filter((r) => r.violation === k).length);
      if (res.rows.length > 0) {
        logger.error({ violations: res.rows }, 'ledger_invariant_violation');
      }
      return { affected: res.rows.length };
    },
  };
}
