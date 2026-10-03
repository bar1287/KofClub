'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { errorMessage } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import type { PlatformOverview } from '@/lib/types';

function Tile({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div
      className="panel"
      style={{
        flex: '1 1 170px',
        background: 'var(--panel-2)',
        borderColor: alert ? 'var(--danger)' : undefined,
      }}
    >
      <div className="muted small">{label}</div>
      <div
        style={{ fontSize: '1.5rem', fontWeight: 700, color: alert ? 'var(--danger)' : undefined }}
      >
        {value.toLocaleString('en-US')}
      </div>
    </div>
  );
}

/** Live platform counters (refreshes every 15 s). */
export function OverviewPanel() {
  const { ep } = useSession();
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await ep.adminOverview());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ep]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="stack" data-testid="admin-overview">
      <div className="row">
        <Tile
          label="Ledger invariant violations"
          value={data.ledger.invariantViolations}
          alert={data.ledger.invariantViolations > 0}
        />
        <Tile label="Open risk cases" value={data.risk.openEvents} />
        <Tile
          label="High-severity open"
          value={data.risk.highSeverityOpen}
          alert={data.risk.highSeverityOpen > 0}
        />
      </div>
      <div className="row">
        <Tile label="Hands in progress" value={data.hands.inProgress} />
        <Tile label="Hands completed (24 h)" value={data.hands.completedLast24h} />
        <Tile
          label="Hands voided (24 h)"
          value={data.hands.voidedLast24h}
          alert={data.hands.voidedLast24h > 0}
        />
        <Tile label="Open tables" value={data.tables.open} />
        <Tile label="Seated players" value={data.tables.seatedPlayers} />
      </div>
      <div className="row">
        <Tile label="Accounts" value={data.users.total} />
        <Tile label="Suspended accounts" value={data.users.suspended} />
        <Tile label="Active sessions" value={data.sessions.active} />
        <Tile label="Clubs" value={data.clubs.total} />
        <Tile label="Suspended clubs" value={data.clubs.suspended} />
      </div>
      <p className="muted small">
        Updated {new Date(data.generatedAt).toLocaleTimeString()}. Service metrics (latency,
        WebSocket connections, resyncs) are in Grafana — see docs/observability.md.
      </p>
    </div>
  );
}
