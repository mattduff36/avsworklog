import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

export const DA2_V2_MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260813_zzz_daily_allocation_v2_visit_model.sql'
);
export const DA2_PGLITE_BASE_PATH = resolve(
  process.cwd(),
  'tests/db/daily-allocation-v2-pglite-base.sql'
);

export const DA2_ACTORS = {
  manager: '11111111-1111-4111-8111-111111111111',
  employeeA: '22222222-2222-4222-8222-222222222222',
  employeeB: '33333333-3333-4333-8333-333333333333',
  jobA: '44444444-4444-4444-8444-444444444444',
  jobB: '55555555-5555-4555-8555-555555555555',
  plant: '66666666-6666-4666-8666-666666666666',
} as const;

export interface DailyAllocationV1ContentHash {
  labour_count: number;
  plant_count: number;
  publication_count: number;
  labour_hash: string;
  plant_hash: string;
}

export async function createDailyAllocationV2Pglite(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { btree_gist, pgcrypto } });
  await pg.exec(`
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  `);
  await pg.exec(readFileSync(DA2_PGLITE_BASE_PATH, 'utf8'));
  return pg;
}

export async function applyDailyAllocationV2Migration(pg: PGlite): Promise<void> {
  await pg.exec(readFileSync(DA2_V2_MIGRATION_PATH, 'utf8'));
}

export async function hashDailyAllocationV1Content(pg: PGlite): Promise<DailyAllocationV1ContentHash> {
  const result = await pg.query<DailyAllocationV1ContentHash>(`
    SELECT
      (SELECT COUNT(*)::int FROM public.daily_labour_allocation_drafts) AS labour_count,
      (SELECT COUNT(*)::int FROM public.daily_plant_allocation_drafts) AS plant_count,
      (SELECT COUNT(*)::int FROM public.daily_allocation_publications) AS publication_count,
      md5(COALESCE((
        SELECT string_agg(
          id::text || '|' || work_date::text || '|' || profile_id::text
            || '|' || COALESCE(job_code, '') || '|' || COALESCE(site_address, ''),
          E'\\n' ORDER BY id
        )
        FROM public.daily_labour_allocation_drafts
      ), '')) AS labour_hash,
      md5(COALESCE((
        SELECT string_agg(
          id::text || '|' || work_date::text || '|' || COALESCE(plant_id::text, '')
            || '|' || COALESCE(job_code, ''),
          E'\\n' ORDER BY id
        )
        FROM public.daily_plant_allocation_drafts
      ), '')) AS plant_hash
  `);
  return result.rows[0];
}

export async function withAuthenticatedRole<T>(
  pg: PGlite,
  userId: string,
  run: () => Promise<T>
): Promise<T> {
  await pg.exec(`
    SELECT set_config('request.jwt.claim.sub', '${userId}', false);
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    SET ROLE authenticated;
  `);
  try {
    return await run();
  } finally {
    await pg.exec(`
      RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claims', '', false);
    `);
  }
}

export async function enableDailyAllocationV2(pg: PGlite): Promise<void> {
  await pg.exec(`
    UPDATE private.daily_allocation_v2_runtime
    SET board_enabled = TRUE, writes_enabled = TRUE, updated_at = NOW()
    WHERE singleton = TRUE;
  `);
}

export function sqlErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.message}\n${error.stack || ''}`;
  return String(error);
}
