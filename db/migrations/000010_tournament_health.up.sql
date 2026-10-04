-- Tournament monitoring (read-only views). The worker exports them as
-- gauges; alerts page on violations and stuck work
-- (docs/runbooks/tournaments.md).

-- Rows here indicate a defect: tournament chips, prize pools or results
-- that do not add up. Every check holds at all times (all writes are
-- atomic and verified in their transaction), so any row is actionable.
CREATE VIEW tournament_invariant_violations AS
  -- Chips in play: seat stacks at the tournament's tables (at hand
  -- boundaries) plus chips moving between tables = entrants x stack.
  SELECT 'CHIPS_NOT_CONSERVED'::text AS violation, r.tournament_id, r.total_chips AS expected,
         (coalesce(s.seated, 0) + coalesce(x.moving, 0))::bigint AS actual
    FROM tournament_runtime r
    LEFT JOIN LATERAL (SELECT sum(ts.stack_cached) AS seated FROM table_seats ts
                         JOIN tables t ON t.id = ts.table_id WHERE t.tournament_id = r.tournament_id) s ON true
    LEFT JOIN LATERAL (SELECT sum(stack) AS moving FROM tournament_transfers
                        WHERE tournament_id = r.tournament_id) x ON true
   WHERE r.status = 'RUNNING' AND coalesce(s.seated, 0) + coalesce(x.moving, 0) <> r.total_chips
  UNION ALL
  -- Prize pools: the active buy-ins while registering, the frozen prize pool
  -- while running, empty once finished or cancelled.
  SELECT 'POOL_MISMATCH', t.id, e.amount, coalesce(a.balance, 0)
    FROM tournaments t
    LEFT JOIN tournament_runtime r ON r.tournament_id = t.id
    LEFT JOIN ledger_accounts a ON a.kind = 'TOURNAMENT_POOL' AND a.owner_id = t.id
    CROSS JOIN LATERAL (SELECT CASE
        WHEN r.status = 'RUNNING' THEN r.prize_pool
        WHEN r.status IS NOT NULL OR t.status = 'CANCELLED' THEN 0
        ELSE coalesce((SELECT sum(g.buy_in) FROM tournament_registrations g
                        WHERE g.tournament_id = t.id AND g.status = 'ACTIVE'), 0)
      END::bigint AS amount) e
   WHERE coalesce(a.balance, 0) <> e.amount
  UNION ALL
  -- A finished tournament placed everybody and paid exactly its pool.
  SELECT 'RESULTS_INCOMPLETE', r.tournament_id, r.prize_pool, coalesce(p.paid, 0)::bigint
    FROM tournament_runtime r
    LEFT JOIN LATERAL (SELECT sum(prize) AS paid, count(*) FILTER (WHERE place IS NULL) AS unplaced,
                              count(*) FILTER (WHERE place = 1) AS winners
                         FROM tournament_entries WHERE tournament_id = r.tournament_id) p ON true
   WHERE r.status = 'FINISHED' AND (coalesce(p.paid, 0) <> r.prize_pool OR p.unplaced > 0 OR p.winners < 1);

-- One row of operational state: running tournaments, players in transit
-- (and for how long) and tournaments whose start is overdue by a minute.
CREATE VIEW tournament_health AS
  SELECT
    (SELECT count(*) FROM tournament_runtime WHERE status = 'RUNNING')::int AS running,
    (SELECT count(*) FROM tournament_transfers)::int AS transfers_pending,
    coalesce((SELECT extract(epoch FROM now() - min(created_at)) FROM tournament_transfers), 0)::double precision
      AS oldest_transfer_seconds,
    (SELECT count(*) FROM tournaments t
      CROSS JOIN LATERAL (SELECT count(*) AS active, max(g.created_at) AS last_registered
                            FROM tournament_registrations g
                           WHERE g.tournament_id = t.id AND g.status = 'ACTIVE') g
      WHERE t.status = 'REGISTERING'
        AND NOT EXISTS (SELECT 1 FROM tournament_runtime r WHERE r.tournament_id = t.id)
        AND ((t.start_mode = 'SCHEDULED' AND t.starts_at < now() - interval '1 minute')
             OR (t.start_requested_at < now() - interval '1 minute' AND g.active >= t.min_players)
             OR (t.start_mode = 'SIT_AND_GO' AND g.active >= t.max_players
                 AND g.last_registered < now() - interval '1 minute')))::int AS overdue_starts;
