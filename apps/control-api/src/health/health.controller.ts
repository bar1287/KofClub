import { Public } from '../common/auth/public.decorator';
import { NoRateLimit } from '../common/rate-limit/no-rate-limit.decorator';
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthReport, HealthService } from './health.service';

@Public()
@NoRateLimit()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): HealthReport {
    return this.health.live();
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.ready();
    res.setHeader('Cache-Control', 'no-store');
    if (report.status !== 'ok') res.status(503);
    return report;
  }
}
