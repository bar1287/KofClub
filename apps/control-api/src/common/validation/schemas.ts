import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const limitSchema = z.coerce.number().int().min(1).max(100).default(50);

export const cursorSchema = z.string().max(512).optional();

/** Opaque keyset pagination cursor helpers. */
export function encodeCursor(value: Record<string, string>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<K extends string>(
  cursor: string | undefined,
  keys: readonly K[],
): Record<K, string> | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('bad cursor');
    const out = {} as Record<K, string>;
    for (const k of keys) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v !== 'string') throw new Error('bad cursor');
      out[k] = v;
    }
    return out;
  } catch {
    throw new z.ZodError([
      { code: 'custom', path: ['cursor'], message: 'Invalid cursor', input: cursor },
    ]);
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
