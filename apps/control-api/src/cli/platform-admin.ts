/* eslint-disable no-console */
import { Pool } from 'pg';
import { uuidv7 } from '../common/ids';
import { Database } from '../infra/database/database';
import { AuditService } from '../modules/audit/audit.service';

/**
 * Grants or revokes the platform-administrator role. This is deliberately
 * the only way to create administrators: it needs direct database access
 * (an operator running a one-off task), never an HTTP call. Every change is
 * written to the audit log.
 *
 *   node dist/cli/platform-admin.js grant <username>
 *   node dist/cli/platform-admin.js revoke <username>
 *   node dist/cli/platform-admin.js reset-mfa <username>
 *
 * `reset-mfa` removes a user's two-factor authentication (lost device and
 * recovery codes, ADR-017) after the operator verified their identity out of
 * band; it also revokes every session of the user.
 */
async function main(argv: string[]): Promise<number> {
  const [command, username] = argv;
  if ((command !== 'grant' && command !== 'revoke' && command !== 'reset-mfa') || !username) {
    console.error('usage: platform-admin grant|revoke|reset-mfa <username>');
    return 2;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    return 2;
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = new Database(pool);
  const audit = new AuditService(db);
  try {
    if (command === 'reset-mfa') {
      const revoked = await resetMfa(db, audit, username);
      console.log(
        revoked === null
          ? `${username} has no two-factor authentication`
          : `two-factor authentication reset for ${username}; ${revoked} session(s) revoked`,
      );
      return 0;
    }
    const role = command === 'grant' ? 'PLATFORM_ADMIN' : 'USER';
    const changed = await db.tx(async (q) => {
      const res = await q.query<{ id: string; platform_role: string }>(
        `SELECT id, platform_role FROM users WHERE username = $1 FOR UPDATE`,
        [username],
      );
      const user = res.rows[0];
      if (!user) throw new Error(`no user named ${username}`);
      if (user.platform_role === role) return false;
      await q.query(`UPDATE users SET platform_role = $2, updated_at = now() WHERE id = $1`, [
        user.id,
        role,
      ]);
      await audit.record(
        q,
        { requestId: `cli-${uuidv7()}`, ipHash: null, userAgent: 'platform-admin-cli' },
        {
          action: command === 'grant' ? 'PLATFORM_ADMIN_GRANTED' : 'PLATFORM_ADMIN_REVOKED',
          objectType: 'user',
          objectId: user.id,
          before: { platformRole: user.platform_role },
          after: { platformRole: role },
        },
      );
      return true;
    });
    console.log(changed ? `${username} is now ${role}` : `${username} already has role ${role}`);
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  } finally {
    await pool.end();
  }
}

/** Removes a user's second factor and revokes their sessions (audited). */
async function resetMfa(
  db: Database,
  audit: AuditService,
  username: string,
): Promise<number | null> {
  return db.tx(async (q) => {
    const res = await q.query<{ id: string }>(
      `SELECT id FROM users WHERE username = $1 FOR UPDATE`,
      [username],
    );
    const user = res.rows[0];
    if (!user) throw new Error(`no user named ${username}`);
    const mfa = await q.query(`DELETE FROM user_mfa WHERE user_id = $1`, [user.id]);
    await q.query(`DELETE FROM user_mfa_recovery_codes WHERE user_id = $1`, [user.id]);
    if (mfa.rowCount === 0) return null;
    const sessions = await q.query(
      `UPDATE sessions SET revoked_at = now(), revoke_reason = 'ADMIN'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    await audit.record(
      q,
      { requestId: `cli-${uuidv7()}`, ipHash: null, userAgent: 'platform-admin-cli' },
      { action: 'MFA_RESET', objectType: 'user', objectId: user.id },
    );
    return sessions.rowCount ?? 0;
  });
}

void main(process.argv.slice(2)).then((code) => process.exit(code));
