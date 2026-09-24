import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { stripOuterMigrationTransaction } from '../../scripts/finalise-migrations';

export const CONTRACTOR_TRANSITION_MIGRATION_PATH =
  'supabase/migrations/20260924152132_contractor_role_transition.sql';
export const CONTRACTOR_TRANSITION_BASE_PATH =
  'tests/db/contractor-role-transition-pglite-base.sql';

export const CONTRACTOR_TRANSITION_IDS = {
  profile: '11111111-1111-4111-8111-111111111111',
  employeeRole: '22222222-2222-4222-8222-222222222222',
  contractorRole: '33333333-3333-4333-8333-333333333333',
  annualLeave: '44444444-4444-4444-8444-444444444444',
  unpaidLeave: '55555555-5555-4555-8555-555555555555',
  bulkBatch: '66666666-6666-4666-8666-666666666666',
} as const;

function readSql(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

export async function createContractorTransitionPgliteBase(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  await pg.exec(readSql(CONTRACTOR_TRANSITION_BASE_PATH));
  return pg;
}

export async function applyContractorTransitionMigration(pg: PGlite): Promise<void> {
  await pg.exec(stripOuterMigrationTransaction(readSql(CONTRACTOR_TRANSITION_MIGRATION_PATH)));
}

export async function setContractorTransitionAuthRole(
  pg: PGlite,
  role: string | null
): Promise<void> {
  await pg.query(
    `SELECT set_config('request.jwt.claim.role', $1, false);`,
    [role || '']
  );
}
