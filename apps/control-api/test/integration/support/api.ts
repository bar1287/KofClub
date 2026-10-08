import { randomBytes, randomInt } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { makeUser } from '@kofclub/test-fixtures';
import request from 'supertest';

/** A random documentation-range IP so each test user has its own rate-limit bucket. */
export function randomIp(): string {
  return `198.51.${randomInt(0, 255)}.${randomInt(1, 254)}`;
}

export interface TestUser {
  id: string;
  email: string;
  username: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  ip: string;
}

export async function registerUser(app: INestApplication, prefix = 'player'): Promise<TestUser> {
  const input = makeUser(prefix);
  const ip = randomIp();
  const res = await request(app.getHttpServer())
    .post('/v1/auth/register')
    .set('X-Forwarded-For', ip)
    .send({ ...input, deviceId: `dev-${randomBytes(4).toString('hex')}` })
    .expect(201);
  return {
    id: res.body.user.id,
    email: input.email,
    username: input.username,
    password: input.password,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    sessionId: res.body.sessionId,
    ip,
  };
}

/** Supertest agent bound to a user's token and IP. */
export function as(app: INestApplication, user: Pick<TestUser, 'accessToken' | 'ip'>) {
  const server = app.getHttpServer();
  const wrap = (t: request.Test) =>
    t.set('Authorization', `Bearer ${user.accessToken}`).set('X-Forwarded-For', user.ip);
  return {
    get: (url: string) => wrap(request(server).get(url)),
    post: (url: string) => wrap(request(server).post(url)),
    put: (url: string) => wrap(request(server).put(url)),
    patch: (url: string) => wrap(request(server).patch(url)),
    delete: (url: string) => wrap(request(server).delete(url)),
  };
}
