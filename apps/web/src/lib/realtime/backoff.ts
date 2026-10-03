/**
 * Exponential backoff with "equal jitter": half of the capped exponential
 * delay is fixed, the other half random, so reconnecting clients spread
 * out after a gateway restart instead of stampeding.
 */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const capped = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 20));
  return Math.round(capped / 2 + (capped / 2) * random());
}
