import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { uuidv7 } from '../../common/ids';
import type { AuthContext, RequestContext } from '../../common/request-context';
import { decodeCursor, encodeCursor, Page } from '../../common/validation/schemas';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Database, Queryable } from '../../infra/database/database';
import { MetricsService } from '../../metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { ClubAccessService } from '../clubs/club-access.service';
import { ClubsRepository } from '../clubs/clubs.repository';
import { TelegramAccountsRepository } from '../identity/telegram-accounts.repository';
import { ClubPlansService, PlanLimits } from '../plans/club-plans.service';
import { TelegramApiError, TelegramClient } from '../telegram/telegram.client';
import {
  catalog,
  Entitlement,
  findProduct,
  ProductId,
  SUBSCRIPTION_PERIOD_SECONDS,
} from './store.catalog';
import { StarOrderRow, StarPaymentRow, StoreRepository } from './store.repository';
import {
  alreadyRefunded,
  isRenewal,
  PreCheckoutQuery,
  SuccessfulPayment,
} from './telegram-payments';

export interface StoreProductDto {
  id: ProductId;
  kind: 'SUBSCRIPTION' | 'ONE_TIME' | 'TIP';
  title: string;
  description: string;
  stars: number;
  periodDays: number | null;
  owned: boolean;
}

export interface StoreCatalogDto {
  enabled: boolean;
  botUsername: string | null;
  products: StoreProductDto[];
}

export interface StarPaymentDto {
  id: string;
  orderId: string | null;
  product: ProductId | null;
  clubId: string | null;
  userId: string | null;
  username: string | null;
  stars: number;
  recurring: boolean;
  subscriptionExpiresAt: string | null;
  paidAt: string;
  refundedAt: string | null;
  refundReason: string | null;
}

export interface ClubPlanDto {
  clubId: string;
  plan: 'FREE' | 'PRO';
  activeUntil: string | null;
  renewing: boolean;
  canManageRenewal: boolean;
  limitsEnforced: boolean;
  limits: PlanLimits;
  proLimits: PlanLimits;
}

/** The result of a payment Telegram reported, for the bot's reply. */
export interface PaymentOutcome {
  duplicate: boolean;
  matched: boolean;
  product: ProductId | null;
  activeUntil: Date | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toPaymentDto(p: StarPaymentRow): StarPaymentDto {
  return {
    id: p.id,
    orderId: p.orderId,
    product: p.product,
    clubId: p.clubId,
    userId: p.userId,
    username: p.username,
    stars: p.stars,
    recurring: p.recurring,
    subscriptionExpiresAt: p.subscriptionExpiresAt?.toISOString() ?? null,
    paidAt: p.paidAt.toISOString(),
    refundedAt: p.refundedAt?.toISOString() ?? null,
    refundReason: p.refundReason,
  };
}

/**
 * Why Telegram must decline a checkout (shown to the payer), or null to
 * accept: only the order's own payer, in Stars, at the order's price, once.
 */
export function checkoutProblem(
  order: StarOrderRow | null,
  query: PreCheckoutQuery,
): string | null {
  if (!order) return 'This purchase was not found. Start again from the app.';
  if (order.status !== 'PENDING') return 'This purchase is already paid.';
  if (query.currency !== 'XTR') return 'Pay with Telegram Stars.';
  if (query.from.id !== order.telegramUserId) return 'Start this purchase from your own account.';
  if (query.total_amount !== order.stars) return 'The price changed. Start again from the app.';
  return null;
}

/**
 * The Telegram Stars store (T2, ADR-018). It sells Club Pro, premium themes
 * and tips, never chips, seats, entries or prizes, and never touches the
 * chip ledger. Telegram reports payments to the bot webhook; each charge is
 * recorded once (by its charge id) and fulfilled in the same transaction.
 */
@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  constructor(
    private readonly db: Database,
    private readonly repo: StoreRepository,
    private readonly plans: ClubPlansService,
    private readonly access: ClubAccessService,
    private readonly clubs: ClubsRepository,
    private readonly telegramAccounts: TelegramAccountsRepository,
    private readonly telegram: TelegramClient,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Purchases are possible on this deployment. */
  get enabled(): boolean {
    return this.config.TELEGRAM_STARS_ENABLED && Boolean(this.config.TELEGRAM_BOT_TOKEN);
  }

  async catalog(userId: string): Promise<StoreCatalogDto> {
    const owned = new Set<Entitlement>(await this.repo.entitlements(userId));
    return {
      enabled: this.enabled,
      botUsername: this.config.TELEGRAM_BOT_TOKEN
        ? (this.config.TELEGRAM_BOT_USERNAME ?? null)
        : null,
      products: catalog(this.config).map((p) => ({
        id: p.id,
        kind: p.kind,
        title: p.title,
        description: p.description,
        stars: p.stars,
        periodDays: p.periodDays,
        owned: p.entitlement !== null && owned.has(p.entitlement),
      })),
    };
  }

  async myStore(
    userId: string,
  ): Promise<{ entitlements: Entitlement[]; payments: StarPaymentDto[] }> {
    const [entitlements, payments] = await Promise.all([
      this.repo.entitlements(userId),
      this.repo.listForUser(userId),
    ]);
    return { entitlements, payments: payments.map(toPaymentDto) };
  }

  /** Creates an order and its Stars invoice link (opened in the Mini App). */
  async createOrder(
    auth: AuthContext,
    input: { product: ProductId; clubId?: string | undefined },
  ): Promise<{ orderId: string; invoiceLink: string }> {
    this.requireEnabled();
    const product = findProduct(this.config, input.product);
    if ((product.id === 'CLUB_PRO') !== (input.clubId !== undefined)) {
      throw new AppError('VALIDATION_FAILED', 'clubId is required for Club Pro and only for it');
    }
    const account = await this.telegramAccounts.findByUser(auth.userId);
    if (!account) {
      throw new AppError('TELEGRAM_NOT_LINKED', 'Link your Telegram account to pay with Stars');
    }
    if (input.clubId) await this.checkCanBuyPro(auth, input.clubId);
    if (product.entitlement && (await this.owns(auth.userId, product.entitlement))) {
      throw new AppError('CONFLICT', 'You already own this');
    }
    const order = await this.repo.insertOrder(this.db, {
      id: uuidv7(),
      userId: auth.userId,
      telegramUserId: account.telegramUserId,
      product: product.id,
      clubId: input.clubId ?? null,
      stars: product.stars,
    });
    let invoiceLink: string;
    try {
      invoiceLink = await this.telegram.call<string>('createInvoiceLink', {
        title: product.title,
        description: product.description,
        payload: order.id,
        currency: 'XTR',
        prices: [{ label: product.title, amount: product.stars }],
        ...(product.kind === 'SUBSCRIPTION'
          ? { subscription_period: SUBSCRIPTION_PERIOD_SECONDS }
          : {}),
      });
    } catch (err) {
      if (err instanceof TelegramApiError) {
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          'Telegram could not create the invoice; try again',
        );
      }
      throw err;
    }
    this.metrics.storeEvents.inc({ event: 'order', product: product.id });
    return { orderId: order.id, invoiceLink };
  }

  /**
   * Telegram asks before charging (answer within 10 seconds). Returns the
   * reason to decline, or null to accept.
   */
  async preCheckout(query: PreCheckoutQuery): Promise<string | null> {
    if (!this.enabled) return 'Purchases are not available right now.';
    const order = UUID_RE.test(query.invoice_payload)
      ? await this.repo.findOrder(query.invoice_payload)
      : null;
    const problem =
      checkoutProblem(order, query) ?? (order ? await this.orderProblem(order) : null);
    this.metrics.storeEvents.inc({
      event: problem ? 'checkout_declined' : 'checkout_accepted',
      product: order?.product ?? 'unknown',
    });
    return problem;
  }

  /** Records and fulfils a payment Telegram reported (repeats are no-ops). */
  async paymentReceived(
    fromId: number,
    payment: SuccessfulPayment,
    ctx: RequestContext,
  ): Promise<PaymentOutcome> {
    const orderId = UUID_RE.test(payment.invoice_payload) ? payment.invoice_payload : null;
    const outcome = await this.db.tx(async (q): Promise<PaymentOutcome> => {
      const order = orderId ? await this.repo.findOrder(orderId, q) : null;
      // A payment that matches no order is still recorded, so it can be refunded.
      const payer = order ? null : await this.telegramAccounts.findByTelegramId(fromId, q);
      const expires = payment.subscription_expiration_date
        ? new Date(payment.subscription_expiration_date * 1000)
        : null;
      const paymentId = await this.repo.insertPayment(q, {
        id: uuidv7(),
        orderId: order?.id ?? null,
        userId: order?.userId ?? payer?.userId ?? null,
        telegramUserId: fromId,
        telegramChargeId: payment.telegram_payment_charge_id,
        stars: payment.total_amount,
        recurring: isRenewal(payment),
        subscriptionExpiresAt: expires,
      });
      const base = { product: order?.product ?? null, activeUntil: null };
      if (!paymentId) return { ...base, duplicate: true, matched: order !== null };
      const matched =
        order !== null &&
        payment.currency === 'XTR' &&
        order.telegramUserId === fromId &&
        order.stars === payment.total_amount;
      if (!order || !matched) return { ...base, duplicate: false, matched: false };

      await this.repo.markOrderPaid(q, order.id);
      const product = findProduct(this.config, order.product);
      if (product.entitlement)
        await this.repo.grant(q, order.userId, product.entitlement, paymentId);
      let activeUntil: Date | null = null;
      if (order.product === 'CLUB_PRO' && order.clubId) {
        const sub = await this.plans.activate(q, {
          clubId: order.clubId,
          orderId: order.id,
          subscriberUserId: order.userId,
          subscriberTelegramId: fromId,
          subscriptionChargeId: payment.telegram_payment_charge_id,
          activeUntil: expires ?? new Date(Date.now() + SUBSCRIPTION_PERIOD_SECONDS * 1000),
        });
        activeUntil = sub.activeUntil;
        await this.audit.record(q, ctx, {
          action: isRenewal(payment) ? 'CLUB_PRO_RENEWED' : 'CLUB_PRO_STARTED',
          objectType: 'club',
          objectId: order.clubId,
          clubId: order.clubId,
          after: { subscriberUserId: order.userId, activeUntil: activeUntil.toISOString() },
        });
      }
      return { duplicate: false, matched: true, product: order.product, activeUntil };
    });
    const event = outcome.duplicate ? 'payment_duplicate' : outcome.matched ? 'paid' : 'unmatched';
    if (event === 'unmatched') this.logger.warn({ orderId }, 'stars_payment_unmatched');
    this.metrics.storeEvents.inc({ event, product: outcome.product ?? 'unknown' });
    return outcome;
  }

  /** Telegram reports a refund (made here or by Telegram itself). */
  async paymentRefunded(chargeId: string, ctx: RequestContext): Promise<boolean> {
    return this.db.tx(async (q) => {
      const p = await this.repo.findPaymentByCharge(chargeId, q);
      if (!p || !(await this.repo.markRefunded(q, p.id, 'Refunded by Telegram'))) return false;
      await this.takeBack(q, p, ctx);
      this.metrics.storeEvents.inc({ event: 'refunded', product: p.product ?? 'unknown' });
      return true;
    });
  }

  async adminPayments(query: {
    limit: number;
    cursor?: string | undefined;
  }): Promise<Page<StarPaymentDto>> {
    const after = decodeCursor(query.cursor, ['paidAt', 'id'] as const);
    const rows = await this.repo.listAll(query.limit + 1, after ?? null);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toPaymentDto),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ paidAt: last.cursorKey, id: last.id })
          : null,
    };
  }

  /** Refunds a payment through Telegram and takes back what it bought. */
  async adminRefund(
    paymentId: string,
    reason: string,
    ctx: RequestContext,
  ): Promise<StarPaymentDto> {
    const p = await this.repo.findPayment(paymentId);
    if (!p) throw new AppError('NOT_FOUND', 'Payment not found');
    if (p.refundedAt) throw new AppError('CONFLICT', 'This payment was already refunded');
    try {
      await this.telegram.call<boolean>('refundStarPayment', {
        user_id: p.telegramUserId,
        telegram_payment_charge_id: p.telegramChargeId,
      });
    } catch (err) {
      if (!(err instanceof TelegramApiError)) throw err;
      if (!alreadyRefunded(err.message)) {
        throw new AppError('SERVICE_UNAVAILABLE', 'Telegram did not refund the payment; try again');
      }
    }
    if (p.product === 'CLUB_PRO' && p.clubId) await this.stopRenewal(p.clubId, p.orderId);
    const refunded = await this.db.tx(async (q) => {
      if (await this.repo.markRefunded(q, p.id, reason)) await this.takeBack(q, p, ctx);
      await this.audit.record(q, ctx, {
        action: 'STAR_PAYMENT_REFUNDED',
        objectType: 'star_payment',
        objectId: p.id,
        clubId: p.clubId,
        after: { product: p.product, stars: p.stars, reason },
      });
      return this.repo.findPayment(p.id, q);
    });
    this.metrics.storeEvents.inc({ event: 'refunded', product: p.product ?? 'unknown' });
    return toPaymentDto(refunded!);
  }

  async clubPlan(auth: AuthContext, clubId: string): Promise<ClubPlanDto> {
    await this.access.require(clubId, auth, 'CLUB_VIEW');
    return this.planDto(auth, clubId);
  }

  /** The subscriber cancels or resumes the monthly Club Pro renewal. */
  async setRenewal(
    auth: AuthContext,
    clubId: string,
    renewing: boolean,
    ctx: RequestContext,
  ): Promise<ClubPlanDto> {
    this.requireEnabled();
    await this.access.require(clubId, auth, 'CLUB_VIEW');
    const state = await this.plans.state(clubId);
    const sub = state.subscription;
    if (!sub || state.plan !== 'PRO') {
      throw new AppError('CONFLICT', 'This club has no active Club Pro');
    }
    if (sub.subscriberUserId !== auth.userId) {
      throw new AppError('FORBIDDEN', 'Only the subscriber can change the renewal');
    }
    if (sub.renewing !== renewing) {
      try {
        await this.telegram.call<boolean>('editUserStarSubscription', {
          user_id: sub.subscriberTelegramId,
          telegram_payment_charge_id: sub.subscriptionChargeId,
          is_canceled: !renewing,
        });
      } catch (err) {
        if (err instanceof TelegramApiError) {
          throw new AppError(
            'SERVICE_UNAVAILABLE',
            'Telegram did not change the renewal; try again',
          );
        }
        throw err;
      }
      await this.db.tx(async (q) => {
        await this.plans.setRenewing(q, clubId, renewing);
        await this.audit.record(q, ctx, {
          action: renewing ? 'CLUB_PRO_RENEWAL_RESUMED' : 'CLUB_PRO_RENEWAL_CANCELED',
          objectType: 'club',
          objectId: clubId,
          clubId,
        });
      });
    }
    return this.planDto(auth, clubId);
  }

  private async planDto(auth: AuthContext, clubId: string): Promise<ClubPlanDto> {
    const state = await this.plans.state(clubId);
    const sub = state.plan === 'PRO' ? state.subscription : null;
    return {
      clubId,
      plan: state.plan,
      activeUntil: sub?.activeUntil.toISOString() ?? null,
      renewing: sub?.renewing ?? false,
      canManageRenewal: this.enabled && sub !== null && sub.subscriberUserId === auth.userId,
      limitsEnforced: state.limitsEnforced,
      limits: state.limits,
      proLimits: state.proLimits,
    };
  }

  private requireEnabled(): void {
    if (!this.enabled) {
      throw new AppError('STORE_DISABLED', 'The Stars store is not available here');
    }
  }

  private async owns(userId: string, entitlement: Entitlement): Promise<boolean> {
    return (await this.repo.entitlements(userId)).includes(entitlement);
  }

  private async checkCanBuyPro(auth: AuthContext, clubId: string): Promise<void> {
    const { club, membership } = await this.access.require(clubId, auth, 'CLUB_VIEW');
    if (membership?.role !== 'OWNER') {
      throw new AppError('FORBIDDEN', 'Only the club owner can buy Club Pro');
    }
    if (club.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Club is suspended');
    const state = await this.plans.state(clubId);
    if (state.plan === 'PRO' && state.subscription?.renewing) {
      throw new AppError('CONFLICT', 'Club Pro is already active and renews monthly');
    }
  }

  /** What changed since the order was made that rules out paying for it. */
  private async orderProblem(order: StarOrderRow): Promise<string | null> {
    if (order.product === 'CLUB_PRO' && order.clubId) {
      const [club, member, state] = await Promise.all([
        this.clubs.findClub(order.clubId),
        this.clubs.findMembership(order.clubId, order.userId),
        this.plans.state(order.clubId),
      ]);
      if (club?.status !== 'ACTIVE' || member?.status !== 'ACTIVE' || member.role !== 'OWNER') {
        return 'Only the owner of an active club can buy Club Pro.';
      }
      if (state.plan === 'PRO' && state.subscription?.renewing) {
        return 'This club already has Club Pro.';
      }
    }
    const product = findProduct(this.config, order.product);
    if (product.entitlement && (await this.owns(order.userId, product.entitlement))) {
      return 'You already own this.';
    }
    return null;
  }

  /** Takes back what a refunded payment bought. */
  private async takeBack(q: Queryable, p: StarPaymentRow, ctx: RequestContext): Promise<void> {
    await this.repo.revokeForPayment(q, p.id);
    if (p.product === 'CLUB_PRO' && p.orderId && p.clubId) {
      if (await this.plans.endForOrder(q, p.orderId)) {
        await this.audit.record(q, ctx, {
          action: 'CLUB_PRO_ENDED',
          objectType: 'club',
          objectId: p.clubId,
          clubId: p.clubId,
          after: { reason: 'REFUND' },
        });
      }
    }
  }

  /** Best effort: a refunded Club Pro must not renew again. */
  private async stopRenewal(clubId: string, orderId: string | null): Promise<void> {
    const sub = (await this.plans.state(clubId)).subscription;
    if (!sub || sub.orderId !== orderId || !sub.renewing) return;
    await this.telegram
      .call('editUserStarSubscription', {
        user_id: sub.subscriberTelegramId,
        telegram_payment_charge_id: sub.subscriptionChargeId,
        is_canceled: true,
      })
      .catch(() => undefined);
  }
}
