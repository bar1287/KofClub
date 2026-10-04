import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { base32Decode, timeStep, totp } from '../../../src/modules/identity/mfa/totp';
import { as, TestUser } from './api';

export interface Enrollment {
  userId: string;
  secret: string;
  recoveryCodes: string[];
  /** Time step of the last code used (codes are accepted once per step). */
  lastStep: number;
}

/** Enrolls TOTP through the API; the user's current session becomes verified. */
export async function enrollMfa(app: INestApplication, user: TestUser): Promise<Enrollment> {
  const start = await as(app, user).post('/v1/me/mfa/totp').expect(201);
  const secret: string = start.body.secret;
  const now = Date.now();
  const confirm = await as(app, user)
    .post('/v1/me/mfa/totp/confirm')
    .send({ code: totp(base32Decode(secret), now) })
    .expect(200);
  return {
    userId: user.id,
    secret,
    recoveryCodes: confirm.body.recoveryCodes,
    lastStep: timeStep(now),
  };
}

/**
 * A code not used yet: the current step's, or the next step's (accepted as
 * clock drift). Only two codes exist per 30 seconds, so when both were used
 * the helper forgets the used steps in the database (tests need more codes
 * than a person typing them).
 */
export async function freshCode(e: Enrollment, db: Pool): Promise<string> {
  const current = timeStep(Date.now());
  let step = Math.max(current, e.lastStep + 1);
  if (step > current + 1) {
    await db.query(`UPDATE user_mfa SET last_used_step = $2 WHERE user_id = $1`, [
      e.userId,
      current - 1,
    ]);
    step = current;
  }
  e.lastStep = step;
  return totp(base32Decode(e.secret), step * 30_000);
}
