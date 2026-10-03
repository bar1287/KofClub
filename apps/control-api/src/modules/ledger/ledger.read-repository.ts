import { Injectable } from '@nestjs/common';
import { Database } from '../../infra/database/database';
import { AccountKind, LedgerKind, toChips } from './ledger.repository';

export interface WalletEntryRow {
  entryId: string;
  txId: string;
  kind: LedgerKind;
  amount: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
  cursorKey: string;
}

export interface TransactionRow {
  id: string;
  kind: LedgerKind;
  actorType: string;
  actorUserId: string | null;
  actorUsername: string | null;
  referenceType: string | null;
  referenceId: string | null;
  reversesTxId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  cursorKey: string;
  entries: Array<{
    accountId: string;
    accountKind: AccountKind;
    ownerId: string;
    ownerUsername: string | null;
    tableId: string | null;
    amount: number;
    balanceAfter: number;
  }>;
}

export interface BalanceRow {
  userId: string;
  username: string;
  walletBalance: number;
  tableBalance: number;
}

/** Read-side queries over the ledger (owned by the ledger module). */
@Injectable()
export class LedgerReadRepository {
  constructor(private readonly db: Database) {}

  async walletEntries(
    accountId: string,
    limit: number,
    after?: { createdAt: string; id: string },
  ): Promise<WalletEntryRow[]> {
    const params: unknown[] = [accountId, limit];
    let where = 'e.account_id = $1';
    if (after) {
      params.push(after.createdAt, after.id);
      where += ` AND (e.created_at, e.id) < ($3::timestamptz, $4::uuid)`;
    }
    const res = await this.db.query<{
      id: string;
      tx_id: string;
      kind: LedgerKind;
      amount_signed: string;
      balance_after: string;
      reference_type: string | null;
      reference_id: string | null;
      created_at: Date;
      cursor_key: string;
    }>(
      `SELECT e.id, e.tx_id, t.kind, e.amount_signed, e.balance_after, t.reference_type, t.reference_id,
              e.created_at, e.created_at::text AS cursor_key
         FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.tx_id
        WHERE ${where}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT $2`,
      params,
    );
    return res.rows.map((r) => ({
      entryId: r.id,
      txId: r.tx_id,
      kind: r.kind,
      amount: toChips(r.amount_signed),
      balanceAfter: toChips(r.balance_after),
      referenceType: r.reference_type,
      referenceId: r.reference_id,
      createdAt: r.created_at.toISOString(),
      cursorKey: r.cursor_key,
    }));
  }

  async summary(
    clubId: string,
  ): Promise<{ issued: number; wallets: number; tables: number; holders: number }> {
    const res = await this.db.query<{
      treasury: string;
      wallets: string;
      tables: string;
      holders: number;
    }>(
      `SELECT coalesce(sum(balance) FILTER (WHERE kind = 'CLUB_TREASURY'), 0) AS treasury,
              coalesce(sum(balance) FILTER (WHERE kind = 'MEMBER_WALLET'), 0) AS wallets,
              coalesce(sum(balance) FILTER (WHERE kind = 'TABLE_STACK'), 0) AS tables,
              count(DISTINCT owner_id) FILTER (WHERE kind <> 'CLUB_TREASURY' AND balance <> 0)::int AS holders
         FROM ledger_accounts WHERE club_id = $1`,
      [clubId],
    );
    const r = res.rows[0]!;
    return {
      issued: -toChips(r.treasury),
      wallets: toChips(r.wallets),
      tables: toChips(r.tables),
      holders: r.holders,
    };
  }

  async balances(clubId: string, limit: number, afterUsername?: string): Promise<BalanceRow[]> {
    const params: unknown[] = [clubId, limit];
    let cursor = '';
    if (afterUsername) {
      params.push(afterUsername);
      cursor = 'AND u.username > $3';
    }
    const res = await this.db.query<{
      user_id: string;
      username: string;
      wallet: string;
      tables: string;
    }>(
      `SELECT m.user_id, u.username,
              coalesce(sum(a.balance) FILTER (WHERE a.kind = 'MEMBER_WALLET'), 0) AS wallet,
              coalesce(sum(a.balance) FILTER (WHERE a.kind = 'TABLE_STACK'), 0) AS tables
         FROM club_members m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN ledger_accounts a ON a.club_id = m.club_id AND a.owner_id = m.user_id
        WHERE m.club_id = $1 AND m.status <> 'LEFT' ${cursor}
        GROUP BY m.user_id, u.username
        ORDER BY u.username
        LIMIT $2`,
      params,
    );
    return res.rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      walletBalance: toChips(r.wallet),
      tableBalance: toChips(r.tables),
    }));
  }

  async transactions(
    clubId: string,
    limit: number,
    after?: { createdAt: string; id: string },
    txId?: string,
  ): Promise<TransactionRow[]> {
    const params: unknown[] = [clubId, limit];
    const where = ['t.club_id = $1'];
    if (txId) {
      params.push(txId);
      where.push(`t.id = $${params.length}`);
    }
    if (after) {
      params.push(after.createdAt, after.id);
      where.push(
        `(t.created_at, t.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    const res = await this.db.query<{
      id: string;
      kind: LedgerKind;
      actor_type: string;
      actor_user_id: string | null;
      actor_username: string | null;
      reference_type: string | null;
      reference_id: string | null;
      reverses_tx_id: string | null;
      metadata_json: Record<string, unknown>;
      created_at: Date;
      cursor_key: string;
      entries: Array<{
        account_id: string;
        kind: AccountKind;
        owner_id: string;
        owner_username: string | null;
        table_id: string | null;
        amount: number | string;
        balance_after: number | string;
      }>;
    }>(
      `SELECT t.id, t.kind, t.actor_type, t.actor_user_id, au.username AS actor_username,
              t.reference_type, t.reference_id, t.reverses_tx_id, t.metadata_json, t.created_at,
              t.created_at::text AS cursor_key,
              (SELECT json_agg(json_build_object(
                        'account_id', a.id, 'kind', a.kind, 'owner_id', a.owner_id,
                        'owner_username', ou.username, 'table_id', a.table_id,
                        'amount', e.amount_signed::text, 'balance_after', e.balance_after::text)
                      ORDER BY e.amount_signed)
                 FROM ledger_entries e
                 JOIN ledger_accounts a ON a.id = e.account_id
                 LEFT JOIN users ou ON ou.id = a.owner_id AND a.owner_type = 'USER'
                WHERE e.tx_id = t.id) AS entries
         FROM ledger_transactions t
         LEFT JOIN users au ON au.id = t.actor_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $2`,
      params,
    );
    return res.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      actorType: r.actor_type,
      actorUserId: r.actor_user_id,
      actorUsername: r.actor_username,
      referenceType: r.reference_type,
      referenceId: r.reference_id,
      reversesTxId: r.reverses_tx_id,
      metadata: r.metadata_json,
      createdAt: r.created_at.toISOString(),
      cursorKey: r.cursor_key,
      entries: (r.entries ?? []).map((e) => ({
        accountId: e.account_id,
        accountKind: e.kind,
        ownerId: e.owner_id,
        ownerUsername: e.owner_username,
        tableId: e.table_id,
        amount: toChips(e.amount),
        balanceAfter: toChips(e.balance_after),
      })),
    }));
  }
}
