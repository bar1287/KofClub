import type { ConnectionStatus } from '@/lib/realtime/client';

const LABEL: Record<ConnectionStatus, string> = {
  idle: 'Offline',
  connecting: 'Connecting…',
  open: 'Connected',
  reconnecting: 'Reconnecting…',
  unauthorized: 'Signed out',
  closed: 'Disconnected',
};

export function ConnectionBadge({
  status,
  syncing,
}: {
  status: ConnectionStatus;
  syncing: boolean;
}) {
  const label = status === 'open' && syncing ? 'Syncing…' : LABEL[status];
  return (
    <span className="badge" data-testid="connection-status" data-status={status}>
      <span className={`conn-dot ${syncing && status === 'open' ? 'reconnecting' : status}`} />
      {label}
    </span>
  );
}
