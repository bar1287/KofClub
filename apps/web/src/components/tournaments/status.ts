import { chips } from '@/lib/format';
import type { Tournament, TournamentStatus } from '@/lib/types';

export const STATUS_LABEL: Record<TournamentStatus, string> = {
  REGISTERING: 'Registering',
  RUNNING: 'Running',
  FINISHED: 'Finished',
  CANCELLED: 'Cancelled',
};

export const STATUS_BADGE: Record<TournamentStatus, string> = {
  REGISTERING: 'badge green',
  RUNNING: 'badge yellow',
  FINISHED: 'badge',
  CANCELLED: 'badge',
};

export function buyInLabel(t: Pick<Tournament, 'buyIn'>): string {
  return t.buyIn === 0 ? 'Freeroll' : chips(t.buyIn);
}

export function startLabel(t: Pick<Tournament, 'startMode' | 'startsAt' | 'maxPlayers'>): string {
  if (t.startMode === 'SIT_AND_GO') return `When ${t.maxPlayers} registered`;
  return t.startsAt ? new Date(t.startsAt).toLocaleString() : 'Scheduled';
}
