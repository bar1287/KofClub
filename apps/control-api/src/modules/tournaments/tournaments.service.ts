import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { uuidv7 } from '../../common/ids';
import type { AuthContext, RequestContext } from '../../common/request-context';
import { Database, Queryable } from '../../infra/database/database';
import { AuditService } from '../audit/audit.service';
import { ClubAccessService } from '../clubs/club-access.service';
import { LedgerRepository } from '../ledger/ledger.repository';
import { blindLevels, levelAt, prizes, tableCount, type BlindLevel } from './structure';
import { EntrantRow, TournamentRow, TournamentsRepository } from './tournaments.repository';
import type { CreateTournamentInput } from './tournaments.schemas';

export type TournamentDto = Omit<
  TournamentRow,
  'directoryStatus' | 'started' | 'smallBlind' | 'bigBlind'
>;

export interface TournamentDetailDto extends TournamentDto {
  levels: BlindLevel[];
  currentLevel: BlindLevel | null;
  levelEndsAt: string | null;
  payouts: Array<{ place: number; amount: number }>;
  entrants: EntrantRow[];
  playersLeft: number;
  myTableId: string | null;
}

const LEVELS_SHOWN = 20;

function toDto(t: TournamentRow): TournamentDto {
  const { directoryStatus: _d, started: _s, smallBlind: _sb, bigBlind: _bb, ...dto } = t;
  return dto;
}

/**
 * Tournament directory and registration (spec §16 M10, ADR-016). Buy-ins,
 * refunds and the prize pool are ledger postings (virtual chips, ADR-006).
 * The game service starts tournaments, seats and moves players, eliminates
 * them and pays the prizes out; this module only reads that runtime state.
 */
@Injectable()
export class TournamentsService {
  constructor(
    private readonly db: Database,
    private readonly repo: TournamentsRepository,
    private readonly access: ClubAccessService,
    private readonly ledger: LedgerRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    auth: AuthContext,
    clubId: string,
    input: CreateTournamentInput,
    ctx: RequestContext,
  ): Promise<TournamentDetailDto> {
    const id = uuidv7();
    const tables = Array.from({ length: tableCount(input.maxPlayers, input.seatsPerTable) }, () =>
      uuidv7(),
    );
    await this.db.tx(async (q) => {
      await this.access.require(clubId, auth, 'TABLES_MANAGE', q);
      await this.repo.insert(
        q,
        {
          id,
          clubId,
          name: input.name,
          gameType: input.gameType,
          buyIn: input.buyIn,
          startingStack: input.startingStack,
          smallBlind: input.smallBlind,
          bigBlind: input.bigBlind,
          levelDurationSec: input.levelDurationSec,
          seatsPerTable: input.seatsPerTable,
          minPlayers: input.minPlayers,
          maxPlayers: input.maxPlayers,
          startMode: input.startMode,
          startsAt: input.startsAt ?? null,
          actionTimeoutMs: input.actionTimeoutSec * 1000,
          createdBy: auth.userId,
        },
        tables,
      );
      await this.audit.record(q, ctx, {
        action: 'TOURNAMENT_CREATED',
        objectType: 'tournament',
        objectId: id,
        clubId,
        after: { ...input, tables: tables.length },
      });
    });
    return this.detail(auth, id);
  }

  async list(auth: AuthContext, clubId: string): Promise<TournamentDto[]> {
    await this.access.require(clubId, auth, 'CLUB_VIEW');
    return (await this.repo.listForClub(clubId, auth.userId)).map(toDto);
  }

  async detail(auth: AuthContext, id: string): Promise<TournamentDetailDto> {
    const t = await this.requireTournament(auth, id);
    const entrants = await this.repo.entrants(id, t.started);
    const structure = {
      smallBlind: t.smallBlind,
      bigBlind: t.bigBlind,
      levelDurationSec: t.levelDurationSec,
    };
    let currentLevel: BlindLevel | null = null;
    let levelEndsAt: string | null = null;
    if (t.status === 'RUNNING' && t.startedAt) {
      const now = Date.now();
      const at = levelAt(structure, now - Date.parse(t.startedAt));
      currentLevel = at.level;
      levelEndsAt = new Date(now + at.endsInMs).toISOString();
    }
    const finished = t.status === 'FINISHED';
    const payouts = finished
      ? entrants
          .filter((e) => e.prize > 0 && e.place !== null)
          .map((e) => ({ place: e.place!, amount: e.prize }))
      : prizes(Math.max(t.registeredCount, 2), t.prizePool).map((amount, i) => ({
          place: i + 1,
          amount,
        }));
    const me = entrants.find((e) => e.userId === auth.userId);
    return {
      ...toDto(t),
      levels: blindLevels(structure, LEVELS_SHOWN),
      currentLevel,
      levelEndsAt,
      payouts,
      entrants,
      playersLeft: t.started ? entrants.filter((e) => e.place === null).length : t.registeredCount,
      myTableId: t.status === 'RUNNING' ? (me?.tableId ?? null) : null,
    };
  }

  async register(auth: AuthContext, id: string): Promise<TournamentDetailDto> {
    await this.db.tx(async (q) => {
      const t = await this.lockOpen(q, auth, id);
      const { club, membership } = await this.access.require(t.clubId, auth, 'CLUB_VIEW', q);
      if (!membership) throw new AppError('NOT_CLUB_MEMBER', 'Only club members can register');
      if (club.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Club is suspended');
      if (await this.repo.activeRegistration(q, id, auth.userId)) {
        throw new AppError('ALREADY_REGISTERED', 'You are already registered');
      }
      if (t.registeredCount >= t.maxPlayers) {
        throw new AppError('TOURNAMENT_FULL', 'The tournament is full');
      }
      const registrationId = uuidv7();
      await this.repo.insertRegistration(q, {
        id: registrationId,
        tournamentId: id,
        userId: auth.userId,
        buyIn: t.buyIn,
      });
      if (t.buyIn > 0) {
        const wallet = await this.ledger.ensureAccount(q, t.clubId, 'MEMBER_WALLET', auth.userId);
        const pool = await this.ledger.ensureAccount(q, t.clubId, 'TOURNAMENT_POOL', id);
        await this.ledger.post(q, {
          externalRef: `tournament-buyin:${registrationId}`,
          kind: 'TOURNAMENT_BUY_IN',
          clubId: t.clubId,
          actorType: 'USER',
          actorUserId: auth.userId,
          referenceType: 'tournament',
          referenceId: id,
          entries: [
            { accountId: wallet, amount: -t.buyIn, reason: 'TOURNAMENT_BUY_IN' },
            { accountId: pool, amount: t.buyIn, reason: 'TOURNAMENT_BUY_IN' },
          ],
        });
      }
    });
    return this.detail(auth, id);
  }

  async unregister(auth: AuthContext, id: string): Promise<TournamentDetailDto> {
    await this.db.tx(async (q) => {
      const t = await this.lockOpen(q, auth, id);
      const registration = await this.repo.activeRegistration(q, id, auth.userId);
      if (!registration) throw new AppError('NOT_REGISTERED', 'You are not registered');
      await this.refund(q, t, { ...registration, userId: auth.userId }, auth.userId);
      await this.repo.setRegistrationStatus(q, registration.id, 'UNREGISTERED');
    });
    return this.detail(auth, id);
  }

  async start(auth: AuthContext, id: string, ctx: RequestContext): Promise<TournamentDetailDto> {
    await this.db.tx(async (q) => {
      const t = await this.lockOpen(q, auth, id);
      await this.access.require(t.clubId, auth, 'TABLES_MANAGE', q);
      if (t.registeredCount < t.minPlayers) {
        throw new AppError('NOT_ENOUGH_PLAYERS', `At least ${t.minPlayers} players are needed`, {
          registered: t.registeredCount,
        });
      }
      await this.repo.requestStart(q, id);
      await this.audit.record(q, ctx, {
        action: 'TOURNAMENT_START_REQUESTED',
        objectType: 'tournament',
        objectId: id,
        clubId: t.clubId,
        after: { registered: t.registeredCount },
      });
    });
    return this.detail(auth, id);
  }

  async cancel(auth: AuthContext, id: string, ctx: RequestContext): Promise<TournamentDetailDto> {
    await this.db.tx(async (q) => {
      const t = await this.lockOpen(q, auth, id);
      await this.access.require(t.clubId, auth, 'TABLES_MANAGE', q);
      const registrations = await this.repo.activeRegistrations(q, id);
      for (const r of registrations) {
        await this.refund(q, t, r, auth.userId);
        await this.repo.setRegistrationStatus(q, r.id, 'REFUNDED');
      }
      await this.repo.markCancelled(q, id);
      await this.audit.record(q, ctx, {
        action: 'TOURNAMENT_CANCELLED',
        objectType: 'tournament',
        objectId: id,
        clubId: t.clubId,
        before: { status: 'REGISTERING' },
        after: { status: 'CANCELLED', refunded: registrations.length },
      });
    });
    return this.detail(auth, id);
  }

  /** Same reference as the game service's refunds: a buy-in is refunded once. */
  private async refund(
    q: Queryable,
    t: TournamentRow,
    r: { id: string; userId: string; buyIn: number },
    actorUserId: string,
  ): Promise<void> {
    if (r.buyIn === 0) return;
    const wallet = await this.ledger.ensureAccount(q, t.clubId, 'MEMBER_WALLET', r.userId);
    const pool = await this.ledger.ensureAccount(q, t.clubId, 'TOURNAMENT_POOL', t.id);
    await this.ledger.post(q, {
      externalRef: `tournament-refund:${r.id}`,
      kind: 'TOURNAMENT_REFUND',
      clubId: t.clubId,
      actorType: 'USER',
      actorUserId,
      referenceType: 'tournament',
      referenceId: t.id,
      entries: [
        { accountId: pool, amount: -r.buyIn, reason: 'TOURNAMENT_REFUND' },
        { accountId: wallet, amount: r.buyIn, reason: 'TOURNAMENT_REFUND' },
      ],
    });
  }

  /** Locks a tournament that must still be open for registration. */
  private async lockOpen(q: Queryable, auth: AuthContext, id: string): Promise<TournamentRow> {
    await this.repo.lock(q, id);
    const t = await this.repo.find(id, auth.userId, q);
    if (!t) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
    await this.access.require(t.clubId, auth, 'CLUB_VIEW', q);
    if (t.status !== 'REGISTERING' || t.started) {
      throw new AppError('TOURNAMENT_NOT_OPEN', 'Registration is closed', { status: t.status });
    }
    return t;
  }

  private async requireTournament(auth: AuthContext, id: string): Promise<TournamentRow> {
    const t = await this.repo.find(id, auth.userId);
    if (!t) throw new AppError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
    await this.access.require(t.clubId, auth, 'CLUB_VIEW');
    return t;
  }
}
