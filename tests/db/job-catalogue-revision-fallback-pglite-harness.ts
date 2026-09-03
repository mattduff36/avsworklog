import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { stripOuterMigrationTransaction } from '../../scripts/finalise-migrations';

export const JOB_CATALOGUE_FALLBACK_MIGRATION_PATH =
  'supabase/migrations/20260903_job_catalogue_revision_fallback.sql';
export const JOB_CATALOGUE_FALLBACK_ROLLBACK_PATH =
  'supabase/rollback/20260903_job_catalogue_revision_fallback.sql';
export const JOB_CATALOGUE_FALLBACK_PGLITE_BASE_PATH =
  'tests/db/job-catalogue-revision-fallback-pglite-base.sql';

export const JOB_CATALOGUE_IDS = {
  customerActive: '11111111-1111-4111-8111-111111111111',
  customerInactive: '22222222-2222-4222-8222-222222222222',
  threadGh: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  originalGh: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  draftGh: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  midSentGh: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  threadNever: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  draftNever: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  threadLost: '12121212-1212-4121-8121-121212121212',
  sentLost: '13131313-1313-4131-8131-131313131313',
  lostLatest: '14141414-1414-4141-8141-141414141414',
  threadClosed: '15151515-1515-4151-8151-151515151515',
  sentClosed: '16161616-1616-4161-8161-161616161616',
  closedLatest: '17171717-1717-4171-8171-171717171717',
  threadCommercial: '18181818-1818-4181-8181-181818181818',
  sentCommercial: '19191919-1919-4191-8191-191919191919',
  latestCommercial: '1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a',
  threadInactive: '1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b',
  sentInactive: '1c1c1c1c-1c1c-41c1-81c1-1c1c1c1c1c1c',
  latestInactive: '1d1d1d1d-1d1d-41d1-81d1-1d1d1d1d1d1d',
  threadAliasSource: '1e1e1e1e-1e1e-41e1-81e1-1e1e1e1e1e1e',
  aliasSourceQuote: '1f1f1f1f-1f1f-41f1-81f1-1f1f1f1f1f1f',
  threadCollisionA: '20202020-2020-4202-8202-202020202020',
  sentCollisionA: '21212121-2121-4212-8212-212121212121',
  threadCollisionB: '22222222-2222-4222-8222-222222222222',
  sentCollisionB: '23232323-2323-4232-8232-232323232323',
} as const;

export function readJobCatalogueFallbackSql(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

export async function createJobCatalogueFallbackPglite(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  await pg.exec(readJobCatalogueFallbackSql(JOB_CATALOGUE_FALLBACK_PGLITE_BASE_PATH));
  await pg.exec(stripOuterMigrationTransaction(readJobCatalogueFallbackSql(JOB_CATALOGUE_FALLBACK_MIGRATION_PATH)));
  return pg;
}

export async function applyJobCatalogueFallbackRollback(pg: PGlite): Promise<void> {
  await pg.exec(stripOuterMigrationTransaction(readJobCatalogueFallbackSql(JOB_CATALOGUE_FALLBACK_ROLLBACK_PATH)));
}

export interface ResolvedAllocationJob {
  source_type: string;
  source_id: string;
  job_code: string;
  site_address: string | null;
  customer_name: string | null;
  title: string | null;
  address_valid: boolean;
}

export async function resolveAllocationJob(
  pg: PGlite,
  sourceType: string | null,
  sourceId: string | null,
  jobCode: string | null
): Promise<ResolvedAllocationJob[]> {
  const result = await pg.query<ResolvedAllocationJob>(
    `SELECT source_type, source_id::text, job_code, site_address, customer_name, title, address_valid
     FROM private.resolve_allocation_job($1, $2::uuid, $3)`,
    [sourceType, sourceId, jobCode]
  );
  return result.rows;
}
