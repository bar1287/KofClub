import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../common/auth/public.decorator';
import { AppError } from '../../common/errors/app-error';
import { NoRateLimit } from '../../common/rate-limit/no-rate-limit.decorator';
import { uuidSchema } from '../../common/validation/schemas';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { ClubAccessService } from '../clubs/club-access.service';
import { UsersRepository } from '../identity/users.repository';
import { TablesRepository } from '../tables/tables.repository';
import { InternalServiceGuard } from './internal-service.guard';

const accessQuery = z.object({ userId: uuidSchema });

export interface TableAccessDecision {
  allowed: boolean;
  clubId?: string;
  code?: string;
}

/**
 * Service-to-service endpoints (never exposed by the edge). The realtime
 * gateway asks here whether a user may subscribe to / act at a table, so
 * authorization rules stay in one place (control-api).
 */
@Public()
@NoRateLimit()
@UseGuards(InternalServiceGuard)
@Controller('internal/v1')
export class InternalController {
  constructor(
    private readonly tables: TablesRepository,
    private readonly users: UsersRepository,
    private readonly access: ClubAccessService,
  ) {}

  @Get('tables/:tableId/access')
  async tableAccess(
    @Param('tableId', new ZodPipe(uuidSchema)) tableId: string,
    @Query(new ZodPipe(accessQuery)) query: z.infer<typeof accessQuery>,
  ): Promise<TableAccessDecision> {
    const table = await this.tables.find(tableId);
    if (!table) return { allowed: false, code: 'TABLE_NOT_FOUND' };
    const user = await this.users.findById(query.userId);
    if (!user) return { allowed: false, code: 'AUTH_REQUIRED' };
    if (user.status !== 'ACTIVE') return { allowed: false, code: 'ACCOUNT_SUSPENDED' };
    try {
      await this.access.require(
        table.clubId,
        { userId: user.id, sessionId: 'internal', platformRole: user.platformRole },
        'CLUB_VIEW',
      );
      return { allowed: true, clubId: table.clubId };
    } catch (err) {
      if (err instanceof AppError) return { allowed: false, clubId: table.clubId, code: err.code };
      throw err;
    }
  }
}
