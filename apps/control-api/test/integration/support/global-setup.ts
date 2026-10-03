import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { integrationEnv } from './env';

declare global {
  var __GAME_SERVICE__: ChildProcess | undefined;
}

const repoRoot = path.resolve(__dirname, '../../../../..');

/**
 * Creates a fresh, fully migrated database and starts a real game-service
 * process against it. Migrations are applied by the same Go migrate tool
 * used in every environment (db/migrations is the single source of schema
 * truth).
 */
export default async function globalSetup(): Promise<void> {
  const env = integrationEnv();
  const admin = new Client({ connectionString: env.adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${env.dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${env.dbName}`);
  } finally {
    await admin.end();
  }

  const migrateBin = process.env.MIGRATE_BIN;
  const [cmd, args] = migrateBin ? [migrateBin, ['up']] : ['go', ['run', './go/cmd/migrate', 'up']];
  execFileSync(cmd, args, {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: env.databaseUrl },
    stdio: 'pipe',
  });

  await startGameService(env.databaseUrl, env.gameServicePort, env.internalToken);
}

async function startGameService(databaseUrl: string, port: number, token: string): Promise<void> {
  let bin = process.env.GAME_SERVICE_BIN;
  if (!bin) {
    bin = path.join(mkdtempSync(path.join(tmpdir(), 'kofclub-game-')), 'game-service');
    execFileSync('go', ['build', '-o', bin, './apps/game-service/cmd/game-service'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  }
  const child = spawn(bin, [], {
    env: {
      ...process.env,
      APP_ENV: 'test',
      LOG_LEVEL: process.env.GAME_LOG_LEVEL ?? 'error',
      DATABASE_URL: databaseUrl,
      GAME_SERVICE_PORT: String(port),
      GAME_NODE_ID: 'it-node-1',
      GAME_NODE_ADVERTISE_URL: `http://127.0.0.1:${port}`,
      INTERNAL_SERVICE_TOKEN: token,
      DECK_ENCRYPTION_KEY_B64: randomBytes(32).toString('base64'),
      HAND_START_DELAY: '100ms',
      HAND_INTERVAL: '200ms',
      DRAIN_DELAY: '10ms',
      DRAIN_TIMEOUT: '2s',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  globalThis.__GAME_SERVICE__ = child;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) throw new Error(`game-service exited with ${child.exitCode}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('game-service did not become ready');
}
