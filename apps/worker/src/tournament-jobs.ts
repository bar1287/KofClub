import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { Gauge, Registry } from 'prom-client';
import type { Job } from './jobs';

type Queryable = Pick<Pool, 'query'>;

const VIOLATIONS = ['CHIPS_NOT_CONSERVED', 'POOL_MISMATCH', 'RESULTS_INCOMPLETE'] as const;

/**
 * Exports tournament monitoring (ADR-016, docs/runbooks/tournaments.md):
 * integrity violations (chips not conserved, prize pools or results that do
 * not add up) and operational state (running tournaments, players stuck
 * between tables, starts that are overdue). Both come from database views,
 * so every game node's work is covered regardless of which node did it.
 */
export function tournamentHealthCheck(pool: Queryable, logger: Logger, registry: Registry): Job {
  const violations = new Gauge({
    name: 'tournament_invariant_violations',
    help: 'Rows in tournament_invariant_violations (must be 0).',
    labelNames: ['violation'] as const,
    registers: [registry],
  });
  const running = new Gauge({
    name: 'tournaments_running',
    help: 'Tournaments in progress.',
    registers: [registry],
  });
  const transfers = new Gauge({
    name: 'tournament_transfers_pending',
    help: 'Players moving between tournament tables right now.',
    registers: [registry],
  });
  const oldest = new Gauge({
    name: 'tournament_transfer_oldest_age_seconds',
    help: 'Age of the oldest pending table transfer (0 when none).',
    registers: [registry],
  });
  const overdue = new Gauge({
    name: 'tournaments_overdue_starts',
    help: 'Tournaments whose start condition was met over a minute ago without starting.',
    registers: [registry],
  });
  return {
    name: 'tournament-health-check',
    async run() {
      const v = await pool.query<{
        violation: string;
        tournament_id: string;
        expected: string;
        actual: string;
      }>(
        'SELECT violation, tournament_id::text, expected::text, actual::text FROM tournament_invariant_violations LIMIT 100',
      );
      for (const k of VIOLATIONS)
        violations.set({ violation: k }, v.rows.filter((r) => r.violation === k).length);
      if (v.rows.length > 0) logger.error({ violations: v.rows }, 'tournament_invariant_violation');

      const h = await pool.query<{
        running: number;
        transfers_pending: number;
        oldest_transfer_seconds: number;
        overdue_starts: number;
      }>(
        'SELECT running, transfers_pending, oldest_transfer_seconds, overdue_starts FROM tournament_health',
      );
      const row = h.rows[0];
      if (row) {
        running.set(row.running);
        transfers.set(row.transfers_pending);
        oldest.set(row.oldest_transfer_seconds);
        overdue.set(row.overdue_starts);
        if (row.overdue_starts > 0)
          logger.warn({ overdue: row.overdue_starts }, 'tournament_start_overdue');
      }
      return { affected: v.rows.length };
    },
  };
}
