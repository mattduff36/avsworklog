import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { stripOuterMigrationTransaction } from '../../scripts/finalise-migrations';

export const DELETE_USER_LEAVE_MIGRATION_PATH =
  'supabase/migrations/20260907230000_delete_user_keep_data_annual_leave.sql';
export const DELETE_USER_LEAVE_PGLITE_BASE_PATH =
  'tests/db/delete-user-annual-leave-pglite-base.sql';

export const DELETE_USER_LEAVE_IDS = {
  active: '11111111-1111-4111-8111-111111111111',
  legacyDeleted: '22222222-2222-4222-8222-222222222222',
  liveDelete: '33333333-3333-4333-8333-333333333333',
  annualLeave: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  unpaidLeave: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
} as const;

function readSql(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

export async function createDeleteUserLeavePgliteBase(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  await pg.exec(readSql(DELETE_USER_LEAVE_PGLITE_BASE_PATH));
  return pg;
}

export async function applyDeleteUserLeaveMigration(pg: PGlite): Promise<void> {
  await pg.exec(stripOuterMigrationTransaction(readSql(DELETE_USER_LEAVE_MIGRATION_PATH)));
}

export async function setAuthRole(pg: PGlite, role: string | null): Promise<void> {
  if (role === null) {
    await pg.exec(`SELECT set_config('request.jwt.claim.role', '', false);`);
    return;
  }
  await pg.query(`SELECT set_config('request.jwt.claim.role', $1, false);`, [role]);
}
