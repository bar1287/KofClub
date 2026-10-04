import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { uuidv7 } from '../../common/ids';
import { Database, Queryable } from '../../infra/database/database';

export type AccountKind = 'CLUB_TREASURY' | 'MEMBER_WALLET' | 'TABLE_STACK' | 'TOURNAMENT_POOL';
export type LedgerKind =
  | 'CLUB_GRANT'
  | 'CLUB_DEDUCTION'
  | 'PROMOTIONAL_CREDIT'
  | 'ADMIN_ADJUSTMENT'
  | 'TABLE_BUY_IN'
  | 'TABLE_CASH_OUT'
  | 'HAND_SETTLEMENT'
  | 'REVERSAL'
  | 'TOURNAMENT_BUY_IN'
  | 'TOURNAMENT_REFUND'
  | 'TOURNAMENT_PAYOUT';

export interface LedgerEntryInput {
  accountId: string;
  amount: number;
  reason?: string;
  handId?: string;
}

export interface Posting {
  externalRef: string;
  kind: LedgerKind;
  clubId: string;
  actorType: 'USER' | 'SYSTEM' | 'GAME_SERVICE';
  actorUserId: string | null;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
  entries: LedgerEntryInput[];
}

/** Largest chip amount accepted on the wire (JSON-safe; mirrors ledger_post). */
export const MAX_CHIP_AMOUNT = 1_000_000_000_000_000;

/** Converts a BIGINT column (returned as string) into a safe JS integer. */
export function toChips(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(n)) {
    throw new AppError('LEDGER_INVARIANT_VIOLATION', 'Chip amount outside the safe integer range');
  }
  return n;
}

/**
 * Maps the ledger's custom SQLSTATEs (db/migrations/000005_ledger.up.sql)
 * to API error codes.
 */
export function mapLedgerError(err: unknown): never {
  const e = err as { code?: string; message?: string };
  switch (e?.code) {
    case 'KL001':
      throw new AppError('INSUFFICIENT_CHIPS', 'Not enough chips');
    case 'KL002':
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for a different operation',
      );
    case 'KL004':
      throw new AppError('CONFLICT', 'Ledger account is not usable');
    case 'KL005':
      throw new AppError('CONFLICT', 'Transaction has already been reversed');
    case 'KL003':
      throw new AppError('LEDGER_INVARIANT_VIOLATION', 'Ledger rejected an invalid transaction');
    default:
      throw err;
  }
}

/**
 * Data access for the ledger module. All writes go through the
 * ledger_post()/ledger_reverse() SQL functions (ADR-003).
 */
@Injectable()
export class LedgerRepository {
  constructor(private readonly db: Database) {}

  async ensureAccount(
    q: Queryable,
    clubId: string,
    kind: AccountKind,
    ownerId: string,
    tableId?: string,
  ): Promise<string> {
    const res = await q.query<{ id: string }>(
      `SELECT ledger_ensure_account($1, $2, $3, $4) AS id`,
      [clubId, kind, ownerId, tableId ?? null],
    );
    return res.rows[0]!.id;
  }

  async post(q: Queryable, p: Posting): Promise<{ txId: string; created: boolean }> {
    try {
      const res = await q.query<{ tx_id: string; created: boolean }>(
        `SELECT tx_id, created FROM ledger_post($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          uuidv7(),
          p.externalRef,
          p.kind,
          p.clubId,
          p.actorType,
          p.actorUserId,
          p.referenceType ?? null,
          p.referenceId ?? null,
          JSON.stringify(p.metadata ?? {}),
          JSON.stringify(p.entries),
        ],
      );
      const row = res.rows[0]!;
      return { txId: row.tx_id, created: row.created };
    } catch (err) {
      mapLedgerError(err);
    }
  }

  async reverse(
    q: Queryable,
    originalTxId: string,
    externalRef: string,
    actorUserId: string,
    metadata: Record<string, unknown>,
  ): Promise<{ txId: string; created: boolean }> {
    try {
      const res = await q.query<{ tx_id: string; created: boolean }>(
        `SELECT tx_id, created FROM ledger_reverse($1, $2, $3, 'USER', $4, $5)`,
        [uuidv7(), originalTxId, externalRef, actorUserId, JSON.stringify(metadata)],
      );
      const row = res.rows[0]!;
      return { txId: row.tx_id, created: row.created };
    } catch (err) {
      mapLedgerError(err);
    }
  }

  async findAccount(
    clubId: string,
    kind: AccountKind,
    ownerId: string,
  ): Promise<{ id: string; balance: number } | null> {
    const res = await this.db.query<{ id: string; balance: string }>(
      `SELECT id, balance FROM ledger_accounts
        WHERE club_id = $1 AND kind = $2 AND owner_id = $3 AND table_id IS NULL`,
      [clubId, kind, ownerId],
    );
    const row = res.rows[0];
    return row ? { id: row.id, balance: toChips(row.balance) } : null;
  }
}
