import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates and normalizes input with a zod schema (errors -> VALIDATION_FAILED). */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
