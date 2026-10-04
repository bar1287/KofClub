import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';
import { toChips } from '../ledger/ledger.repository';
import type { GameType } from '../tables/tables.schemas';
import type { StartMode } from './tournaments.schemas';

export type TournamentStatus = 'REGISTERING' | 'RUNNING' | 'FINISHED' | 'CANCELLED';

export interface TournamentRow {
  id: string;
  clubId: string;
  name: string;
  gameType: GameType;
  status: TournamentStatus;
  /** Directory status (REGISTERING | CANCELLED); `status` folds in the runtime. */
  directoryStatus: 'REGISTERING' | 'CANCELLED';
  started: boolean;
  startMode: StartMode;
  startsAt: string | null;
  buyIn: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  seatsPerTable: number;
  minPlayers: number;
  maxPlayers: number;
  levelDurationSec: number;
  actionTimeoutSec: number;
  registeredCount: number;
  prizePool: number;
  registered: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface EntrantRow {
  userId: string;
  username: string;
  place: number | null;
  prize: number;
  tableId: string | null;
  stack: number | null;
}

// $1 = viewer id. Status: the runtime's (game service) once started,
// otherwise the directory's. The prize pool is the ledger pool before the
// start and the runtime's frozen pool afterwards.
const SELECT = `
  SELECT t.id, t.club_id, t.name, t.game_type, t.status AS directory_status, r.status AS runtime_status,
         t.start_mode, t.starts_at, t.buy_in, t.starting_stack, t.small_blind, t.big_blind, t.seats_per_table,
         t.min_players, t.max_players, t.level_duration_sec, t.action_timeout_ms, t.created_at,
         r.started_at, r.finished_at, r.entrants, r.prize_pool,
         (SELECT count(*)::int FROM tournament_registrations g WHERE g.tournament_id = t.id AND g.status = 'ACTIVE') AS active_count,
         coalesce((SELECT a.balance FROM ledger_accounts a WHERE a.kind = 'TOURNAMENT_POOL' AND a.owner_id = t.id), 0) AS pool_balance,
         (EXISTS (SELECT 1 FROM tournament_registrations g WHERE g.tournament_id = t.id AND g.user_id = $1 AND g.status = 'ACTIVE')
          OR EXISTS (SELECT 1 FROM tournament_entries e WHERE e.tournament_id = t.id AND e.user_id = $1)) AS registered
    FROM tournaments t
    LEFT JOIN tournament_runtime r ON r.tournament_id = t.id`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function map(r: any): TournamentRow {
  const started = r.runtime_status === 'RUNNING' || r.runtime_status === 'FINISHED';
  return {
    id: r.id,
    clubId: r.club_id,
    name: r.name,
    gameType: r.game_type,
    status: (r.runtime_status ?? r.directory_status) as TournamentStatus,
    directoryStatus: r.directory_status,
    started: r.runtime_status !== null,
    startMode: r.start_mode,
    startsAt: r.starts_at ? (r.starts_at as Date).toISOString() : null,
    buyIn: toChips(r.buy_in),
    startingStack: toChips(r.starting_stack),
    smallBlind: toChips(r.small_blind),
    bigBlind: toChips(r.big_blind),
    seatsPerTable: r.seats_per_table,
    minPlayers: r.min_players,
    maxPlayers: r.max_players,
    levelDurationSec: r.level_duration_sec,
    actionTimeoutSec: Math.round(r.action_timeout_ms / 1000),
    registeredCount: started ? r.entrants : r.active_count,
    prizePool: started ? toChips(r.prize_pool) : toChips(r.pool_balance),
    registered: r.registered,
    createdAt: (r.created_at as Date).toISOString(),
    startedAt: started && r.started_at ? (r.started_at as Date).toISOString() : null,
    finishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface NewTournament {
  id: string;
  clubId: string;
  name: string;
  gameType: GameType;
  buyIn: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  levelDurationSec: number;
  seatsPerTable: number;
  minPlayers: number;
  maxPlayers: number;
  startMode: StartMode;
  startsAt: string | null;
  actionTimeoutMs: number;
  createdBy: string;
}

/**
 * Tournament directory (ADR-016): definitions and registrations are written
 * here; runtime state (entries, places, transfers) is written by the game
 * service and only read here.
 */
@Injectable()
export class TournamentsRepository {
  constructor(private readonly db: Database) {}

  async insert(q: Queryable, t: NewTournament, tableIds: string[]): Promise<void> {
    await q.query(
      `INSERT INTO tournaments (id, club_id, name, game_type, buy_in, starting_stack, small_blind, big_blind,
                                level_duration_sec, seats_per_table, min_players, max_players, start_mode, starts_at,
                                action_timeout_ms, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        t.id,
        t.clubId,
        t.name,
        t.gameType,
        t.buyIn,
        t.startingStack,
        t.smallBlind,
        t.bigBlind,
        t.levelDurationSec,
        t.seatsPerTable,
        t.minPlayers,
        t.maxPlayers,
        t.startMode,
        t.startsAt,
        t.actionTimeoutMs,
        t.createdBy,
      ],
    );
    // The tournament's tables: hidden from cash lobbies, seated by the game service.
    for (const [i, tableId] of tableIds.entries()) {
      await q.query(
        `INSERT INTO tables (id, club_id, name, game_type, max_seats, small_blind, big_blind, buyin_min, buyin_max,
                             action_timeout_ms, created_by, tournament_id, tournament_table_no)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $12)`,
        [
          tableId,
          t.clubId,
          `${t.name} #${i + 1}`,
          t.gameType,
          t.seatsPerTable,
          t.smallBlind,
          t.bigBlind,
          t.startingStack,
          t.actionTimeoutMs,
          t.createdBy,
          t.id,
          i + 1,
        ],
      );
    }
  }

  async find(id: string, viewerId: string, q: Queryable = this.db): Promise<TournamentRow | null> {
    const res = await q.query(`${SELECT} WHERE t.id = $2`, [viewerId, id]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  /** Locks the directory row (serializes registration, start and cancel). */
  async lock(q: Queryable, id: string): Promise<void> {
    await q.query(`SELECT 1 FROM tournaments WHERE id = $1 FOR UPDATE`, [id]);
  }

  async listForClub(clubId: string, viewerId: string): Promise<TournamentRow[]> {
    const res = await this.db.query(
      `${SELECT} WHERE t.club_id = $2 ORDER BY t.created_at DESC LIMIT 100`,
      [viewerId, clubId],
    );
    return res.rows.map(map);
  }

  async activeRegistration(
    q: Queryable,
    id: string,
    userId: string,
  ): Promise<{ id: string; buyIn: number } | null> {
    const res = await q.query<{ id: string; buy_in: string }>(
      `SELECT id, buy_in FROM tournament_registrations WHERE tournament_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
      [id, userId],
    );
    const r = res.rows[0];
    return r ? { id: r.id, buyIn: toChips(r.buy_in) } : null;
  }

  async activeRegistrations(
    q: Queryable,
    id: string,
  ): Promise<Array<{ id: string; userId: string; buyIn: number }>> {
    const res = await q.query<{ id: string; user_id: string; buy_in: string }>(
      `SELECT id, user_id, buy_in FROM tournament_registrations WHERE tournament_id = $1 AND status = 'ACTIVE' ORDER BY created_at`,
      [id],
    );
    return res.rows.map((r) => ({ id: r.id, userId: r.user_id, buyIn: toChips(r.buy_in) }));
  }

  async insertRegistration(
    q: Queryable,
    r: { id: string; tournamentId: string; userId: string; buyIn: number },
  ): Promise<void> {
    await q.query(
      `INSERT INTO tournament_registrations (id, tournament_id, user_id, buy_in) VALUES ($1, $2, $3, $4)`,
      [r.id, r.tournamentId, r.userId, r.buyIn],
    );
  }

  async setRegistrationStatus(
    q: Queryable,
    registrationId: string,
    status: 'UNREGISTERED' | 'REFUNDED',
  ): Promise<void> {
    await q.query(
      `UPDATE tournament_registrations SET status = $2 WHERE id = $1 AND status = 'ACTIVE'`,
      [registrationId, status],
    );
  }

  async requestStart(q: Queryable, id: string): Promise<void> {
    await q.query(
      `UPDATE tournaments SET start_requested_at = coalesce(start_requested_at, now()) WHERE id = $1`,
      [id],
    );
  }

  async markCancelled(q: Queryable, id: string): Promise<void> {
    await q.query(
      `UPDATE tournaments SET status = 'CANCELLED' WHERE id = $1 AND status = 'REGISTERING'`,
      [id],
    );
  }

  /**
   * Entrants: registered players before the start; afterwards the game
   * service's entries with places, prizes, current tables and stacks.
   */
  async entrants(id: string, started: boolean): Promise<EntrantRow[]> {
    if (!started) {
      const res = await this.db.query<{ user_id: string; username: string }>(
        `SELECT g.user_id, u.username FROM tournament_registrations g JOIN users u ON u.id = g.user_id
          WHERE g.tournament_id = $1 AND g.status = 'ACTIVE' ORDER BY g.created_at`,
        [id],
      );
      return res.rows.map((r) => ({
        userId: r.user_id,
        username: r.username,
        place: null,
        prize: 0,
        tableId: null,
        stack: null,
      }));
    }
    const res = await this.db.query<{
      user_id: string;
      username: string;
      place: number | null;
      prize: string;
      table_id: string | null;
      stack: string | null;
    }>(
      `SELECT e.user_id, u.username, e.place, e.prize, e.table_id,
              (SELECT s.stack_cached FROM table_seats s WHERE s.table_id = e.table_id AND s.user_id = e.user_id) AS stack
         FROM tournament_entries e JOIN users u ON u.id = e.user_id
        WHERE e.tournament_id = $1
        ORDER BY e.place NULLS FIRST, stack DESC NULLS LAST, u.username`,
      [id],
    );
    return res.rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      place: r.place,
      prize: toChips(r.prize),
      tableId: r.table_id,
      stack: r.stack === null ? null : toChips(r.stack),
    }));
  }
}
