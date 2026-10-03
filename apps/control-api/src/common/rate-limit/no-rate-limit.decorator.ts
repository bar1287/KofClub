import { SetMetadata } from '@nestjs/common';

export const SKIP_RATE_LIMIT = 'kofclub:skipRateLimit';

/** Excludes infrastructure probes (health, metrics) from rate limiting. */
export const NoRateLimit = () => SetMetadata(SKIP_RATE_LIMIT, true);
