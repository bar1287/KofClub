import pino from 'pino';
import { Registry } from 'prom-client';
import { tournamentHealthCheck } from './tournament-jobs';

function fakePool(violations: Array<Record<string, string>>, health: Record<string, number>) {
  return {
    query: jest.fn(async (sql: string) =>
      sql.includes('tournament_invariant_violations') ? { rows: violations } : { rows: [health] },
    ),
  };
}

async function value(registry: Registry, name: string, labels?: Record<string, string>) {
  const metric = (await registry.getMetricsAsJSON()).find((m) => m.name === name);
  const v = metric?.values.find((x) =>
    Object.entries(labels ?? {}).every(([k, l]) => x.labels[k] === l),
  );
  return v?.value;
}

describe('tournamentHealthCheck', () => {
  it('exports violations and operational state as gauges', async () => {
    const registry = new Registry();
    const pool = fakePool(
      [{ violation: 'POOL_MISMATCH', tournament_id: 't1', expected: '200', actual: '100' }],
      { running: 2, transfers_pending: 1, oldest_transfer_seconds: 75.5, overdue_starts: 1 },
    );
    const job = tournamentHealthCheck(pool as never, pino({ level: 'silent' }), registry);
    await expect(job.run()).resolves.toEqual({ affected: 1 });
    expect(
      await value(registry, 'tournament_invariant_violations', { violation: 'POOL_MISMATCH' }),
    ).toBe(1);
    expect(
      await value(registry, 'tournament_invariant_violations', {
        violation: 'CHIPS_NOT_CONSERVED',
      }),
    ).toBe(0);
    expect(await value(registry, 'tournaments_running')).toBe(2);
    expect(await value(registry, 'tournament_transfers_pending')).toBe(1);
    expect(await value(registry, 'tournament_transfer_oldest_age_seconds')).toBe(75.5);
    expect(await value(registry, 'tournaments_overdue_starts')).toBe(1);
  });
});
