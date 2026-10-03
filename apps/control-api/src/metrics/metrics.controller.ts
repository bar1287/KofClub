import { Public } from '../common/auth/public.decorator';
import { NoRateLimit } from '../common/rate-limit/no-rate-limit.decorator';
import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Public()
@NoRateLimit()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async scrape(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
