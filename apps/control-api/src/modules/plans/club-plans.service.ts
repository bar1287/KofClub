import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Database, Queryable } from '../../infra/database/database';
import { ClubSubscriptionRow, ClubSubscriptionsRepository } from './club-subscriptions.repository';

export type ClubPlanName = 'FREE' | 'PRO';

export interface PlanLimits {
  maxOpenTables: number;
  maxMembers: number;
}

export interface ClubPlanState {
  plan: ClubPlanName;
  subscription: ClubSubscriptionRow | null;
  /** False where the store is off: no plan limits apply. */
  limitsEnforced: boolean;
  limits: PlanLimits;
  proLimits: PlanLimits;
}

export type LimitKind = 'members' | 'openTables';

/** Whether a subscription pays for Club Pro at `now`. */
export function isProActive(sub: ClubSubscriptionRow | null, now = Date.now()): boolean {
  return sub !== null && sub.activeUntil.getTime() > now;
}

/**
 * Club plans (T2, ADR-018): Free or Club Pro. Club Pro raises how many
 * tables a club can have open and how many members it can have. The limits
 * apply only while the Stars store is on, so deployments without it keep
 * unlimited clubs. Plans never change anything at a table.
 */
@Injectable()
export class ClubPlansService {
  constructor(
    private readonly db: Database,
    private readonly subscriptions: ClubSubscriptionsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get limitsEnforced(): boolean {
    return this.config.TELEGRAM_STARS_ENABLED;
  }

  freeLimits(): PlanLimits {
    return {
      maxOpenTables: this.config.CLUB_FREE_MAX_OPEN_TABLES,
      maxMembers: this.config.CLUB_FREE_MAX_MEMBERS,
    };
  }

  proLimits(): PlanLimits {
    return {
      maxOpenTables: this.config.CLUB_PRO_MAX_OPEN_TABLES,
      maxMembers: this.config.CLUB_PRO_MAX_MEMBERS,
    };
  }

  async state(clubId: string, q: Queryable = this.db): Promise<ClubPlanState> {
    const subscription = await this.subscriptions.find(clubId, q);
    const plan: ClubPlanName = isProActive(subscription) ? 'PRO' : 'FREE';
    return {
      plan,
      subscription,
      limitsEnforced: this.limitsEnforced,
      limits: plan === 'PRO' ? this.proLimits() : this.freeLimits(),
      proLimits: this.proLimits(),
    };
  }

  /** Starts or extends Club Pro after a payment (the store module calls this). */
  activate(q: Queryable, s: Omit<ClubSubscriptionRow, 'renewing'>): Promise<ClubSubscriptionRow> {
    return this.subscriptions.upsert(q, s);
  }

  /** Ends Club Pro paid by a refunded order. */
  endForOrder(q: Queryable, orderId: string): Promise<boolean> {
    return this.subscriptions.endForOrder(q, orderId);
  }

  setRenewing(q: Queryable, clubId: string, renewing: boolean): Promise<void> {
    return this.subscriptions.setRenewing(q, clubId, renewing);
  }

  /**
   * Refuses to add one more member or open table beyond the plan, inside
   * the caller's transaction. `count` returns the current number.
   */
  async checkLimit(
    q: Queryable,
    clubId: string,
    kind: LimitKind,
    count: () => Promise<number>,
  ): Promise<void> {
    if (!this.limitsEnforced) return;
    await this.subscriptions.lockClub(q, clubId);
    const { plan, limits } = await this.state(clubId, q);
    const max = kind === 'members' ? limits.maxMembers : limits.maxOpenTables;
    if ((await count()) < max) return;
    const what = kind === 'members' ? `${max} members` : `${max} open tables`;
    throw new AppError(
      'CLUB_PLAN_LIMIT',
      plan === 'PRO'
        ? `This club has reached the Club Pro limit of ${what}`
        : `Free clubs can have up to ${what}; the owner can upgrade to Club Pro`,
      { kind, max, plan },
    );
  }
}
