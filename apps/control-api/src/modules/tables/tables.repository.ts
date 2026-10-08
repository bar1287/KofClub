import { Injectable } from '@nestjs/common';
import { Database, Queryable } from '../../infra/database/database';
import { toChips } from '../ledger/ledger.repository';
import type { GameType } from './tables.schemas';

export interface TableRow {
  id: string;
  clubId: string;
  name: string;
  gameType: GameType;
  tournamentId: string | null;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  buyInMin: number;
  buyInMax: number;
  actionTimeoutSec: number;
  timeBankSec: number;
  timeBankRefillSec: number;
  status: 'OPEN' | 'CLOSED';
  createdBy: string;
  createdAt: string;
  seatedCount: number;
}

export interface SeatRow {
  seatNo: number;
  userId: string;
  username: string;
  stack: number;
  sittingOut: boolean;
}

const SELECT = `
  SELECT t.id, t.club_id, t.name, t.game_type, t.tournament_id, t.max_seats, t.small_blind, t.big_blind, t.buyin_min, t.buyin_max,
         t.action_timeout_ms, t.time_bank_ms, t.time_bank_refill_ms, t.status, t.created_by, t.created_at,
         (SELECT count(*)::int FROM table_seats s WHERE s.table_id = t.id) AS seated_count
    FROM tables t`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function map(r: any): TableRow {
  return {
    id: r.id,
    clubId: r.club_id,
    name: r.name,
    gameType: r.game_type,
    tournamentId: r.tournament_id,
    maxSeats: r.max_seats,
    smallBlind: toChips(r.small_blind),
    bigBlind: toChips(r.big_blind),
    buyInMin: toChips(r.buyin_min),
    buyInMax: toChips(r.buyin_max),
    actionTimeoutSec: Math.round(r.action_timeout_ms / 1000),
    timeBankSec: Math.round(r.time_bank_ms / 1000),
    timeBankRefillSec: Math.round(r.time_bank_refill_ms / 1000),
    status: r.status,
    createdBy: r.created_by,
    createdAt: (r.created_at as Date).toISOString(),
    seatedCount: r.seated_count,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Table directory (configuration) owned by control-api. Seat rows are owned
 * by the game service and only read here for lobby display.
 */
@Injectable()
export class TablesRepository {
  constructor(private readonly db: Database) {}

  async insert(
    q: Queryable,
    t: {
      id: string;
      clubId: string;
      name: string;
      gameType: GameType;
      maxSeats: number;
      smallBlind: number;
      bigBlind: number;
      buyInMin: number;
      buyInMax: number;
      actionTimeoutMs: number;
      timeBankMs: number;
      timeBankRefillMs: number;
      createdBy: string;
    },
  ): Promise<void> {
    await q.query(
      `INSERT INTO tables (id, club_id, name, game_type, max_seats, small_blind, big_blind, buyin_min, buyin_max,
                           action_timeout_ms, time_bank_ms, time_bank_refill_ms, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        t.id,
        t.clubId,
        t.name,
        t.gameType,
        t.maxSeats,
        t.smallBlind,
        t.bigBlind,
        t.buyInMin,
        t.buyInMax,
        t.actionTimeoutMs,
        t.timeBankMs,
        t.timeBankRefillMs,
        t.createdBy,
      ],
    );
  }

  /** Marks the table CLOSED (terminal). Returns false when it already was. */
  async markClosed(q: Queryable, id: string): Promise<boolean> {
    const res = await q.query(
      `UPDATE tables SET status = 'CLOSED', updated_at = now() WHERE id = $1 AND status = 'OPEN'`,
      [id],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async find(id: string, q: Queryable = this.db): Promise<TableRow | null> {
    const res = await q.query(`${SELECT} WHERE t.id = $1`, [id]);
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async listForClub(clubId: string): Promise<TableRow[]> {
    const res = await this.db.query(
      // Tournament tables are reached through their tournament, not the lobby.
      `${SELECT} WHERE t.club_id = $1 AND t.tournament_id IS NULL ORDER BY t.status, t.created_at`,
      [clubId],
    );
    return res.rows.map(map);
  }

  async seats(tableId: string): Promise<SeatRow[]> {
    const res = await this.db.query<{
      seat_no: number;
      user_id: string;
      username: string;
      stack_cached: string;
      sitting_out: boolean;
    }>(
      `SELECT s.seat_no, s.user_id, u.username, s.stack_cached, s.sitting_out
         FROM table_seats s JOIN users u ON u.id = s.user_id
        WHERE s.table_id = $1 ORDER BY s.seat_no`,
      [tableId],
    );
    return res.rows.map((r) => ({
      seatNo: r.seat_no,
      userId: r.user_id,
      username: r.username,
      stack: toChips(r.stack_cached),
      sittingOut: r.sitting_out,
    }));
  }
}
