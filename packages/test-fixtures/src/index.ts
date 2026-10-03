import { randomBytes } from 'node:crypto';

/** Generates a unique, valid user registration payload for tests. */
export function makeUser(prefix = 'player'): { email: string; username: string; password: string } {
  const suffix = randomBytes(5).toString('hex');
  return {
    email: `${prefix}.${suffix}@example.test`,
    username: `${prefix}_${suffix}`.slice(0, 24),
    password: `Correct-Horse-${suffix}-Battery`,
  };
}
