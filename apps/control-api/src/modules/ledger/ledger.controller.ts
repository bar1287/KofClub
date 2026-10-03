import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AuthContext, Ctx, CurrentAuth, RequestContext } from '../../common/request-context';
import { Page, uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import type { BalanceRow } from './ledger.read-repository';
import {
  ChipMovementInput,
  chipMovementSchema,
  PageQuery,
  pageQuerySchema,
  ReversalInput,
  reversalSchema,
} from './ledger.schemas';
import {
  LedgerService,
  LedgerSummaryDto,
  LedgerTransactionDto,
  WalletDto,
  WalletEntryDto,
} from './ledger.service';

const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/** Chip-moving requests must carry an Idempotency-Key (spec: every state change is idempotent). */
function requireIdempotencyKey(key: string | undefined): string {
  if (!key || !KEY_RE.test(key)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Idempotency-Key header (8-128 chars) is required for chip movements',
    );
  }
  return key;
}

const chipRateLimit = { name: 'ledger:write:user', by: 'user' as const, limit: 120, windowSec: 60 };

@Controller('clubs/:clubId')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('wallet')
  wallet(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
  ): Promise<WalletDto> {
    return this.ledger.wallet(auth, clubId);
  }

  @Get('wallet/entries')
  walletEntries(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Query(new ZodPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<Page<WalletEntryDto>> {
    return this.ledger.walletEntries(auth, clubId, query);
  }

  @Post('chips/grants')
  @RateLimit(chipRateLimit)
  grant(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Body(new ZodPipe(chipMovementSchema)) body: ChipMovementInput,
    @Headers('idempotency-key') key: string | undefined,
    @Ctx() ctx: RequestContext,
  ): Promise<LedgerTransactionDto> {
    return this.ledger.grant(auth, clubId, body, requireIdempotencyKey(key), ctx);
  }

  @Post('chips/deductions')
  @RateLimit(chipRateLimit)
  deduct(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Body(new ZodPipe(chipMovementSchema)) body: ChipMovementInput,
    @Headers('idempotency-key') key: string | undefined,
    @Ctx() ctx: RequestContext,
  ): Promise<LedgerTransactionDto> {
    return this.ledger.deduct(auth, clubId, body, requireIdempotencyKey(key), ctx);
  }

  @Get('ledger/summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
  ): Promise<LedgerSummaryDto> {
    return this.ledger.summary(auth, clubId);
  }

  @Get('ledger/balances')
  balances(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Query(new ZodPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<Page<BalanceRow>> {
    return this.ledger.balances(auth, clubId, query);
  }

  @Get('ledger/transactions')
  transactions(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Query(new ZodPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<Page<LedgerTransactionDto>> {
    return this.ledger.transactions(auth, clubId, query);
  }

  @Post('ledger/transactions/:txId/reversal')
  @RateLimit(chipRateLimit)
  reverse(
    @CurrentAuth() auth: AuthContext,
    @Param('clubId', new ZodPipe(uuidSchema)) clubId: string,
    @Param('txId', new ZodPipe(uuidSchema)) txId: string,
    @Body(new ZodPipe(reversalSchema)) body: ReversalInput,
    @Headers('idempotency-key') key: string | undefined,
    @Ctx() ctx: RequestContext,
  ): Promise<LedgerTransactionDto> {
    return this.ledger.reverse(auth, clubId, txId, body, requireIdempotencyKey(key), ctx);
  }
}
