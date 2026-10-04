/* eslint-disable no-console */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AppError } from '../common/errors/app-error';
import type { AuthContext, RequestContext } from '../common/request-context';
import { loadConfig } from '../config/config';
import { Database } from '../infra/database/database';
import { ClubsService } from '../modules/clubs/clubs.service';
import { AuthService } from '../modules/identity/auth.service';
import { LedgerService } from '../modules/ledger/ledger.service';

interface SeedFile {
  users: Array<{ email: string; username: string; password: string }>;
  clubs: Array<{
    name: string;
    description?: string;
    owner: string;
    members: string[];
    grants?: Record<string, number>;
  }>;
}

/**
 * Loads demo data through the same services the API uses (no raw inserts),
 * so seeded data satisfies every business rule. Idempotent.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (config.APP_ENV === 'production') throw new Error('Refusing to seed a production environment');
  const seedPath =
    process.env.SEED_FILE ?? path.resolve(__dirname, '../../../../db/seeds/demo.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedFile;

  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot({ ...config, LOG_LEVEL: 'warn' }),
    {
      logger: ['error', 'warn'],
    },
  );
  try {
    const authService = app.get(AuthService);
    const clubs = app.get(ClubsService);
    const ledger = app.get(LedgerService);
    const db = app.get(Database);
    const ctx: RequestContext = { requestId: 'seed', ipHash: null, userAgent: 'seed-script' };

    const principals = new Map<string, AuthContext>();
    for (const u of seed.users) {
      let result;
      try {
        result = await authService.register({ ...u, deviceId: 'seed' }, ctx);
        console.log(`user created: ${u.username}`);
      } catch (err) {
        if (
          !(err instanceof AppError) ||
          (err.code !== 'EMAIL_TAKEN' && err.code !== 'USERNAME_TAKEN')
        )
          throw err;
        result = await authService.login(
          { login: u.email, password: u.password, deviceId: 'seed' },
          ctx,
        );
        console.log(`user exists: ${u.username}`);
      }
      principals.set(u.username, {
        userId: result.user.id,
        sessionId: result.sessionId,
        platformRole: result.user.platformRole,
        mfa: false,
      });
    }

    for (const c of seed.clubs) {
      const owner = principals.get(c.owner);
      if (!owner) throw new Error(`unknown owner ${c.owner}`);
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM clubs WHERE owner_user_id = $1 AND name = $2 LIMIT 1`,
        [owner.userId, c.name],
      );
      const club = existing.rows[0]
        ? await clubs.get(owner, existing.rows[0].id)
        : await clubs.create(
            owner,
            { name: c.name, description: c.description },
            { ...ctx, auth: owner },
          );
      console.log(`club ready: ${club.name} (join code ${club.joinCode})`);
      for (const username of c.members) {
        const member = principals.get(username);
        if (!member) throw new Error(`unknown member ${username}`);
        try {
          await clubs.join(member, club.joinCode!, { ...ctx, auth: member }, club.id);
          console.log(`  joined: ${username}`);
        } catch (err) {
          if (!(err instanceof AppError) || err.code !== 'ALREADY_CLUB_MEMBER') throw err;
        }
      }
      for (const [username, amount] of Object.entries(c.grants ?? {})) {
        const member = principals.get(username);
        if (!member) throw new Error(`unknown grant recipient ${username}`);
        // Fixed idempotency keys make re-seeding a no-op for chips too.
        await ledger.grant(
          owner,
          club.id,
          { userId: member.userId, amount, note: 'demo seed' },
          `seed-grant-${username}`,
          {
            ...ctx,
            auth: owner,
          },
        );
        console.log(`  chips: ${username} has ${(await ledger.wallet(member, club.id)).balance}`);
      }
    }
    console.log('seed complete');
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error('seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
