import { Injectable } from '@nestjs/common';
import { Database } from '../../infra/database/database';
import { toChips } from '../ledger/ledger.repository';

export interface HandSummaryRow {
  id: string;
  tableId: string;
  tableName: string;
  clubId: string;
  clubName: string;
  handNo: number;
  status: 'COMPLETED' | 'VOIDED';
  smallBlind: number;
  bigBlind: number;
  board: string[];
  pot: number;
  playerCount: number;
  myNet: number | null;
  startedAt: string;
  endedAt: string;
}

export interface HandRow extends HandSummaryRow {
  buttonSeat: number;
  deckCommitment: string;
  voidReason: string | null;
}

export interface ParticipantRow {
  seat: number;
  userId: string;
  username: string;
  startingStack: number;
  endingStack: number | null;
  contributed: number | null;
  won: number | null;
  net: number | null;
  folded: boolean | null;
  shownCards: string[] | null;
}

export interface HandEventRow {
  seq: number;
  createdAt: string;
  event: Record<string, unknown>;
}

const optChips = (v: string | null): number | null => (v === null ? null : toChips(v));

// $1 = viewer id (for myNet). Finished hands only: an in-progress hand is
// never exposed through history.
const SUMMARY_SELECT = `
  SELECT h.id, h.table_id, t.name AS table_name, h.club_id, c.name AS club_name, h.hand_no, h.status,
         h.small_blind, h.big_blind, h.board, h.started_at, h.ended_at, h.button_seat,
         h.deck_commitment, h.void_reason,
         (SELECT COALESCE(sum(x.contributed), 0) FROM hand_players x WHERE x.hand_id = h.id) AS pot,
         (SELECT count(*)::int FROM hand_players x WHERE x.hand_id = h.id) AS player_count,
         (SELECT x.net FROM hand_players x WHERE x.hand_id = h.id AND x.user_id = $1) AS my_net
    FROM hands h
    JOIN tables t ON t.id = h.table_id
    JOIN clubs c ON c.id = h.club_id`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapHand(r: any): HandRow {
  return {
    id: r.id,
    tableId: r.table_id,
    tableName: r.table_name,
    clubId: r.club_id,
    clubName: r.club_name,
    handNo: Number(r.hand_no),
    status: r.status,
    smallBlind: toChips(r.small_blind),
    bigBlind: toChips(r.big_blind),
    board: r.board as string[],
    pot: toChips(r.pot),
    playerCount: r.player_count,
    myNet: r.status === 'COMPLETED' ? optChips(r.my_net) : null,
    startedAt: (r.started_at as Date).toISOString(),
    endedAt: (r.ended_at as Date).toISOString(),
    buttonSeat: r.button_seat,
    deckCommitment: r.deck_commitment,
    voidReason: r.void_reason,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function toSummary(h: HandRow): HandSummaryRow {
  const { buttonSeat: _b, deckCommitment: _d, voidReason: _v, ...summary } = h;
  return summary;
}

/**
 * Read model over hands persisted by the game service (history domain is
 * read-only; the game service owns these rows).
 */
@Injectable()
export class HistoryRepository {
  constructor(private readonly db: Database) {}

  /** Finished hands the user was dealt into, newest first (hand ids are UUIDv7). */
  async listForUser(userId: string, limit: number, beforeId?: string): Promise<HandSummaryRow[]> {
    const res = await this.db.query(
      `${SUMMARY_SELECT}
         JOIN hand_players me ON me.hand_id = h.id AND me.user_id = $1
        WHERE h.status <> 'IN_PROGRESS' AND ($3::uuid IS NULL OR h.id < $3::uuid)
        ORDER BY h.id DESC
        LIMIT $2`,
      [userId, limit, beforeId ?? null],
    );
    return res.rows.map((r) => toSummary(mapHand(r)));
  }

  async listForClub(
    viewerId: string,
    clubId: string,
    tableId: string | undefined,
    limit: number,
    beforeId?: string,
  ): Promise<HandSummaryRow[]> {
    const res = await this.db.query(
      `${SUMMARY_SELECT}
        WHERE h.club_id = $2 AND h.status <> 'IN_PROGRESS'
          AND ($3::uuid IS NULL OR h.table_id = $3::uuid)
          AND ($5::uuid IS NULL OR h.id < $5::uuid)
        ORDER BY h.id DESC
        LIMIT $4`,
      [viewerId, clubId, tableId ?? null, limit, beforeId ?? null],
    );
    return res.rows.map((r) => toSummary(mapHand(r)));
  }

  async findFinished(handId: string, viewerId: string): Promise<HandRow | null> {
    const res = await this.db.query(
      `${SUMMARY_SELECT} WHERE h.id = $2 AND h.status <> 'IN_PROGRESS'`,
      [viewerId, handId],
    );
    return res.rows[0] ? mapHand(res.rows[0]) : null;
  }

  async participants(handId: string): Promise<ParticipantRow[]> {
    const res = await this.db.query<{
      seat_no: number;
      user_id: string;
      username: string;
      starting_stack: string;
      ending_stack: string | null;
      contributed: string | null;
      won: string | null;
      net: string | null;
      folded: boolean | null;
      shown_cards: string[] | null;
    }>(
      `SELECT hp.seat_no, hp.user_id, u.username, hp.starting_stack, hp.ending_stack, hp.contributed,
              hp.won, hp.net, hp.folded, hp.shown_cards
         FROM hand_players hp JOIN users u ON u.id = hp.user_id
        WHERE hp.hand_id = $1
        ORDER BY hp.seat_no`,
      [handId],
    );
    return res.rows.map((r) => ({
      seat: r.seat_no,
      userId: r.user_id,
      username: r.username,
      startingStack: toChips(r.starting_stack),
      endingStack: optChips(r.ending_stack),
      contributed: optChips(r.contributed),
      won: optChips(r.won),
      net: optChips(r.net),
      folded: r.folded,
      shownCards: r.shown_cards,
    }));
  }

  /** Public event log of a hand (the game service persists public payloads only). */
  async events(handId: string): Promise<HandEventRow[]> {
    const res = await this.db.query<{
      seq: string;
      created_at: Date;
      payload_json: Record<string, unknown>;
    }>(
      `SELECT e.seq, e.created_at, e.payload_json
         FROM game_events e JOIN hands h ON h.id = e.hand_id AND h.table_id = e.table_id
        WHERE e.hand_id = $1
        ORDER BY e.seq`,
      [handId],
    );
    return res.rows.map((r) => ({
      seq: Number(r.seq),
      createdAt: r.created_at.toISOString(),
      event: r.payload_json,
    }));
  }
}
