import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'kofclub:isPublic';

/** Marks a route as not requiring an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
