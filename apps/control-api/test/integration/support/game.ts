import { randomUUID } from 'node:crypto';
import { integrationEnv } from './env';

const env = integrationEnv();
const gameUrl = `http://127.0.0.1:${env.gameServicePort}`;

/** Sends a player command the way the realtime gateway does (service token). */
export async function gameCommand(tableId: string, userId: string, kind: string, amount = 0) {
  const res = await fetch(`${gameUrl}/internal/v1/tables/${tableId}/commands`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.internalToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ userId, commandId: randomUUID(), kind, amount }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

export async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}
