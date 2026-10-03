import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { AuthContext, RequestContext } from '../../common/request-context';
import { decodeCursor, encodeCursor, Page } from '../../common/validation/schemas';
import { Database } from '../../infra/database/database';
import { AuditService } from '../audit/audit.service';
import { ClubAccessService } from '../clubs/club-access.service';
import { ClubsRepository } from '../clubs/clubs.repository';
import { RiskService } from '../risk/risk.service';
import {
  BalanceRow,
  LedgerReadRepository,
  TransactionRow,
  WalletEntryRow,
} from './ledger.read-repository';
import { LedgerRepository } from './ledger.repository';
import type { ChipMovementInput, PageQuery, ReversalInput } from './ledger.schemas';

export type LedgerTransactionDto = Omit<TransactionRow, 'cursorKey'>;
export type WalletEntryDto = Omit<WalletEntryRow, 'cursorKey'>;

export interface WalletDto {
  clubId: string;
  userId: string;
  balance: number;
}

export interface LedgerSummaryDto {
  clubId: string;
  /** Chips issued by the club treasury and currently in circulation. */
  issued: number;
  inWallets: number;
  atTables: number;
  holders: number;
}

function stripCursor<T extends { cursorKey: string }>(row: T): Omit<T, 'cursorKey'> {
  const { cursorKey: _cursorKey, ...rest } = row;
  return rest;
}

/**
 * Club virtual-chip administration (spec M3). Chips have no monetary value
 * (ADR-006): they enter circulation only through audited treasury grants and
 * leave it through deductions; there are no cash flows.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly db: Database,
    private readonly ledger: LedgerRepository,
    private readonly reads: LedgerReadRepository,
    private readonly access: ClubAccessService,
    private readonly clubs: ClubsRepository,
    private readonly audit: AuditService,
    private readonly risk: RiskService,
  ) {}

  async grant(
    auth: AuthContext,
    clubId: string,
    input: ChipMovementInput,
    idempotencyKey: string,
    ctx: RequestContext,
  ): Promise<LedgerTransactionDto> {
    return this.moveChips(auth, clubId, input, idempotencyKey, ctx, 'CLUB_GRANT');
  }

  async deduct(
    auth: AuthContext,
    clubId: string,
    input: ChipMovementInput,
    idempotencyKey: string,
    ctx: RequestContext,
  ): Promise<LedgerTransactionDto> {
    return this.moveChips(auth, clubId, input, idempotencyKey, ctx, 'CLUB_DEDUCTION');
  }

  private async moveChips(
    auth: AuthContext,
    clubId: string,
    input: ChipMovementInput,
    idempotencyKey: string,
    ctx: RequestContext,
    kind: 'CLUB_GRANT' | 'CLUB_DEDUCTION',
  ): Promise<LedgerTransactionDto> {
    const txId = await this.db.tx(async (q) => {
      const { membership: actor } = await this.access.require(clubId, auth, 'CHIPS_MANAGE', q);
      if (!actor) throw new AppError('FORBIDDEN', 'Only club staff can manage chips');
      const target = await this.clubs.findMembership(clubId, input.userId, q);
      const targetOk =
        kind === 'CLUB_GRANT' ? target?.status === 'ACTIVE' : target && target.status !== 'LEFT';
      if (!targetOk)
        throw new AppError('NOT_CLUB_MEMBER', 'Target user is not an active club member');

      const treasury = await this.ledger.ensureAccount(q, clubId, 'CLUB_TREASURY', clubId);
      const wallet = await this.ledger.ensureAccount(q, clubId, 'MEMBER_WALLET', input.userId);
      const sign = kind === 'CLUB_GRANT' ? 1 : -1;
      const { txId, created } = await this.ledger.post(q, {
        externalRef: `${kind === 'CLUB_GRANT' ? 'grant' : 'deduction'}:${clubId}:${auth.userId}:${idempotencyKey}`,
        kind,
        clubId,
        actorType: 'USER',
        actorUserId: auth.userId,
        referenceType: 'club_member',
        referenceId: input.userId,
        metadata: input.note ? { note: input.note } : {},
        entries: [
          { accountId: treasury, amount: -sign * input.amount, reason: kind },
          { accountId: wallet, amount: sign * input.amount, reason: kind },
        ],
      });
      if (created) {
        await this.audit.record(q, ctx, {
          action: kind === 'CLUB_GRANT' ? 'CHIPS_GRANTED' : 'CHIPS_DEDUCTED',
          objectType: 'ledger_transaction',
          objectId: txId,
          clubId,
          after: { userId: input.userId, amount: input.amount, note: input.note ?? null },
        });
        if (kind === 'CLUB_GRANT' && input.userId === auth.userId) {
          // Staff granting chips to themselves is legitimate but worth reviewing.
          await this.risk.record(
            {
              subjectUserId: auth.userId,
              clubId,
              type: 'SELF_CHIP_GRANT',
              severity: 'LOW',
              score: 15,
              featureValues: { amount: input.amount },
              evidenceRefs: [`ledger_transaction:${txId}`],
            },
            q,
          );
        }
      }
      return txId;
    });
    return this.transaction(clubId, txId);
  }

  async reverse(
    auth: AuthContext,
    clubId: string,
    originalTxId: string,
    input: ReversalInput,
    idempotencyKey: string,
    ctx: RequestContext,
  ): Promise<LedgerTransactionDto> {
    const txId = await this.db.tx(async (q) => {
      const { membership } = await this.access.require(clubId, auth, 'CHIPS_MANAGE', q);
      if (!membership) throw new AppError('FORBIDDEN', 'Only club staff can reverse transactions');
      const [original] = await this.reads.transactions(clubId, 1, undefined, originalTxId);
      if (!original) throw new AppError('NOT_FOUND', 'Transaction not found');
      if (
        !['CLUB_GRANT', 'CLUB_DEDUCTION', 'PROMOTIONAL_CREDIT', 'ADMIN_ADJUSTMENT'].includes(
          original.kind,
        )
      ) {
        // Game-driven movements are corrected by the game service, not by hand.
        throw new AppError(
          'FORBIDDEN',
          `${original.kind} transactions cannot be reversed manually`,
        );
      }
      const { txId, created } = await this.ledger.reverse(
        q,
        originalTxId,
        `reversal:${clubId}:${auth.userId}:${idempotencyKey}`,
        auth.userId,
        { note: input.note },
      );
      if (created) {
        await this.audit.record(q, ctx, {
          action: 'LEDGER_REVERSED',
          objectType: 'ledger_transaction',
          objectId: txId,
          clubId,
          before: { originalTxId },
          after: { note: input.note },
        });
      }
      return txId;
    });
    return this.transaction(clubId, txId);
  }

  async wallet(auth: AuthContext, clubId: string): Promise<WalletDto> {
    await this.access.require(clubId, auth, 'CLUB_VIEW');
    const account = await this.ledger.findAccount(clubId, 'MEMBER_WALLET', auth.userId);
    return { clubId, userId: auth.userId, balance: account?.balance ?? 0 };
  }

  async walletEntries(
    auth: AuthContext,
    clubId: string,
    query: PageQuery,
  ): Promise<Page<WalletEntryDto>> {
    await this.access.require(clubId, auth, 'CLUB_VIEW');
    const account = await this.ledger.findAccount(clubId, 'MEMBER_WALLET', auth.userId);
    if (!account) return { items: [], nextCursor: null };
    const after = decodeCursor(query.cursor, ['createdAt', 'id'] as const);
    const rows = await this.reads.walletEntries(account.id, query.limit + 1, after);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(stripCursor),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.cursorKey, id: last.entryId })
          : null,
    };
  }

  async summary(auth: AuthContext, clubId: string): Promise<LedgerSummaryDto> {
    await this.access.require(clubId, auth, 'LEDGER_VIEW');
    const s = await this.reads.summary(clubId);
    return {
      clubId,
      issued: s.issued,
      inWallets: s.wallets,
      atTables: s.tables,
      holders: s.holders,
    };
  }

  async balances(auth: AuthContext, clubId: string, query: PageQuery): Promise<Page<BalanceRow>> {
    await this.access.require(clubId, auth, 'LEDGER_VIEW');
    const after = decodeCursor(query.cursor, ['username'] as const);
    const rows = await this.reads.balances(clubId, query.limit + 1, after?.username);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        rows.length > query.limit && last ? encodeCursor({ username: last.username }) : null,
    };
  }

  async transactions(
    auth: AuthContext,
    clubId: string,
    query: PageQuery,
  ): Promise<Page<LedgerTransactionDto>> {
    await this.access.require(clubId, auth, 'LEDGER_VIEW');
    const after = decodeCursor(query.cursor, ['createdAt', 'id'] as const);
    const rows = await this.reads.transactions(clubId, query.limit + 1, after);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(stripCursor),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.cursorKey, id: last.id })
          : null,
    };
  }

  private async transaction(clubId: string, txId: string): Promise<LedgerTransactionDto> {
    const [row] = await this.reads.transactions(clubId, 1, undefined, txId);
    if (!row) throw new AppError('INTERNAL', 'Posted transaction not found');
    return stripCursor(row);
  }
}
