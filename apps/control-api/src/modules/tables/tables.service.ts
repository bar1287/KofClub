import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { uuidv7 } from '../../common/ids';
import type { AuthContext, RequestContext } from '../../common/request-context';
import { Database } from '../../infra/database/database';
import { AuditService } from '../audit/audit.service';
import { ClubAccessService } from '../clubs/club-access.service';
import { GameServiceClient } from './game-service.client';
import type { CreateTableInput, SeatInput } from './tables.schemas';
import { SeatRow, TableRow, TablesRepository } from './tables.repository';

export interface TableDetailDto extends TableRow {
  seats: SeatRow[];
}

export interface SeatResultDto {
  tableId: string;
  seatNo: number;
  stack: number;
  seq: number;
}

export interface LeaveResultDto {
  tableId: string;
  status: 'LEFT' | 'LEAVING_AFTER_HAND';
  cashOut: number;
}

/**
 * Table directory and the HTTP entry points for seating. Authorization
 * (club membership, bans, roles) is enforced here; game rules, buy-in and
 * cash-out accounting are enforced by the game service that owns the table.
 */
@Injectable()
export class TablesService {
  constructor(
    private readonly db: Database,
    private readonly repo: TablesRepository,
    private readonly access: ClubAccessService,
    private readonly audit: AuditService,
    private readonly game: GameServiceClient,
  ) {}

  async create(
    auth: AuthContext,
    clubId: string,
    input: CreateTableInput,
    ctx: RequestContext,
  ): Promise<TableDetailDto> {
    const id = uuidv7();
    await this.db.tx(async (q) => {
      await this.access.require(clubId, auth, 'TABLES_MANAGE', q);
      await this.repo.insert(q, {
        id,
        clubId,
        name: input.name,
        maxSeats: input.maxSeats,
        smallBlind: input.smallBlind,
        bigBlind: input.bigBlind,
        buyInMin: input.buyInMin,
        buyInMax: input.buyInMax,
        actionTimeoutMs: input.actionTimeoutSec * 1000,
        createdBy: auth.userId,
      });
      await this.audit.record(q, ctx, {
        action: 'TABLE_CREATED',
        objectType: 'table',
        objectId: id,
        clubId,
        after: { ...input },
      });
    });
    return this.detail(auth, id);
  }

  async list(auth: AuthContext, clubId: string): Promise<TableRow[]> {
    await this.access.require(clubId, auth, 'CLUB_VIEW');
    return this.repo.listForClub(clubId);
  }

  async detail(auth: AuthContext, tableId: string): Promise<TableDetailDto> {
    const table = await this.requireTable(auth, tableId);
    return { ...table, seats: await this.repo.seats(tableId) };
  }

  async seat(
    auth: AuthContext,
    tableId: string,
    input: SeatInput,
    idempotencyKey: string | undefined,
    ctx: RequestContext,
  ): Promise<SeatResultDto> {
    const table = await this.requireTable(auth, tableId);
    if (table.status !== 'OPEN') throw new AppError('TABLE_CLOSED', 'Table is closed');
    const res = await this.game.post<{ seatNo: number; stack: number; seq: number }>(
      tableId,
      'seat',
      {
        userId: auth.userId,
        seatNo: input.seatNo ?? 0,
        buyIn: input.buyIn,
        requestId: idempotencyKey ?? uuidv7(),
      },
      ctx.requestId,
    );
    return { tableId, seatNo: res.seatNo, stack: res.stack, seq: res.seq };
  }

  async leave(
    auth: AuthContext,
    tableId: string,
    idempotencyKey: string | undefined,
    ctx: RequestContext,
  ): Promise<LeaveResultDto> {
    // Leaving is always allowed (even after a ban) so chips return to the wallet.
    const table = await this.repo.find(tableId);
    if (!table) throw new AppError('TABLE_NOT_FOUND', 'Table not found');
    const res = await this.game.post<{ status: 'LEFT' | 'LEAVING_AFTER_HAND'; cashOut: number }>(
      tableId,
      'leave',
      { userId: auth.userId, requestId: idempotencyKey ?? uuidv7() },
      ctx.requestId,
    );
    return { tableId, status: res.status, cashOut: res.cashOut };
  }

  async state(auth: AuthContext, tableId: string, ctx: RequestContext): Promise<unknown> {
    await this.requireTable(auth, tableId);
    return this.game.get(tableId, 'snapshot', { viewer: auth.userId }, ctx.requestId);
  }

  private async requireTable(auth: AuthContext, tableId: string): Promise<TableRow> {
    const table = await this.repo.find(tableId);
    if (!table) throw new AppError('TABLE_NOT_FOUND', 'Table not found');
    await this.access.require(table.clubId, auth, 'CLUB_VIEW');
    return table;
  }
}
