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
 */
async function main(argv: string[]): Promise<number> {
  const [command, username] = argv;
  if ((command !== 'grant' && command !== 'revoke') || !username) {
    console.error('usage: platform-admin grant|revoke <username>');
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

void main(process.argv.slice(2)).then((code) => process.exit(code));
