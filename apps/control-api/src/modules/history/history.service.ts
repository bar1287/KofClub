import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { AuthContext, RequestContext } from '../../common/request-context';
import { decodeCursor, encodeCursor, Page } from '../../common/validation/schemas';
import { ClubAccessService } from '../clubs/club-access.service';
import { GameServiceClient } from '../tables/game-service.client';
import {
  HandEventRow,
  HandRow,
  HandSummaryRow,
  HistoryRepository,
  ParticipantRow,
} from './history.repository';

export type ViewerRole = 'PARTICIPANT' | 'CLUB_STAFF' | 'PLATFORM_ADMIN';

export interface HandDetailDto extends HandSummaryRow {
  buttonSeat: number;
  deckCommitment: string;
  voidReason: string | null;
  players: ParticipantRow[];
  myHoleCards: string[] | null;
  events: HandEventRow[];
  viewerRole: ViewerRole;
}

/**
 * Hand history with the ADR-008 visibility policy: participants see the
 * public record plus their own hole cards; club staff (ADMIN+) and platform
 * admins see the public record only; nobody sees unrevealed cards of
 * others. Unauthorized viewers get HAND_NOT_FOUND (existence is not leaked).
 */
@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(
    private readonly repo: HistoryRepository,
    private readonly access: ClubAccessService,
    private readonly game: GameServiceClient,
  ) {}

  async myHands(auth: AuthContext, limit: number, cursor?: string): Promise<Page<HandSummaryRow>> {
    const after = decodeCursor(cursor, ['id'] as const);
    const items = await this.repo.listForUser(auth.userId, limit, after?.id);
    return page(items, limit);
  }

  async clubHands(
    auth: AuthContext,
    clubId: string,
    tableId: string | undefined,
    limit: number,
    cursor?: string,
  ): Promise<Page<HandSummaryRow>> {
    await this.access.require(clubId, auth, 'HANDS_VIEW');
    const after = decodeCursor(cursor, ['id'] as const);
    const items = await this.repo.listForClub(auth.userId, clubId, tableId, limit, after?.id);
    return page(items, limit);
  }

  async hand(auth: AuthContext, handId: string, ctx: RequestContext): Promise<HandDetailDto> {
    const hand = await this.repo.findFinished(handId, auth.userId);
    if (!hand) throw notFound();
    const players = await this.repo.participants(handId);
    const participant = players.some((p) => p.userId === auth.userId);
    const viewerRole = participant ? 'PARTICIPANT' : await this.staffRole(auth, hand);

    let myHoleCards: string[] | null = null;
    if (participant) {
      try {
        myHoleCards = (await this.game.holeCards(handId, auth.userId, ctx.requestId)).cards;
      } catch (err) {
        // The public record stays available when the game plane is not.
        this.logger.warn({ handId, err: (err as Error).message }, 'hole_cards_unavailable');
      }
    }
    const events = await this.repo.events(handId);
    return {
      ...hand,
      players: withShownCards(players, events),
      myHoleCards,
      events,
      viewerRole,
    };
  }

  private async staffRole(auth: AuthContext, hand: HandRow): Promise<ViewerRole> {
    try {
      const { membership } = await this.access.require(hand.clubId, auth, 'HANDS_VIEW');
      return membership ? 'CLUB_STAFF' : 'PLATFORM_ADMIN';
    } catch (err) {
      if (err instanceof AppError) throw notFound();
      throw err;
    }
  }
}

/**
 * Adds cards players showed after the hand (CARDS_SHOWN events, roadmap
 * W1.5) to the cards shown at showdown. Both are public by the players'
 * choice; mucked and folded hands stay private.
 */
export function withShownCards(
  players: ParticipantRow[],
  events: Array<{ event: Record<string, unknown> }>,
): ParticipantRow[] {
  const shown = new Map<number, string[]>();
  for (const { event } of events) {
    if (event.kind !== 'CARDS_SHOWN' || !Array.isArray(event.cards)) continue;
    const seat = Number(event.seat);
    shown.set(seat, [...(shown.get(seat) ?? []), ...(event.cards as string[])]);
  }
  if (shown.size === 0) return players;
  return players.map((p) => {
    const extra = shown.get(p.seat);
    if (!extra) return p;
    const cards = [...(p.shownCards ?? [])];
    for (const c of extra) if (!cards.includes(c)) cards.push(c);
    return { ...p, shownCards: cards };
  });
}

function notFound(): AppError {
  return new AppError('HAND_NOT_FOUND', 'Hand not found');
}

function page(items: HandSummaryRow[], limit: number): Page<HandSummaryRow> {
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: items.length === limit && last ? encodeCursor({ id: last.id }) : null,
  };
}
