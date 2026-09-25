import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { stripOuterMigrationTransaction } from '../../scripts/finalise-migrations';

const CATALOGUE_BASE = 'tests/db/job-catalogue-revision-fallback-pglite-base.sql';
const PLANT_BASE = 'tests/db/plant-inspection-job-fields-pglite-base.sql';
const ALLOCATION_FIELDS = 'tests/db/plant-inspection-allocation-job-fields.sql';
const RESOLVE_MIGRATION = 'supabase/migrations/20260903_job_catalogue_revision_fallback.sql';
const PLANT_MIGRATION = 'supabase/migrations/20260925_plant_inspection_active_job_codes.sql';

function readSql(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

export async function createPlantInspectionJobPglite(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  await pg.exec(readSql(CATALOGUE_BASE));
  await pg.exec(readSql(PLANT_BASE));
  await pg.exec(stripOuterMigrationTransaction(readSql(RESOLVE_MIGRATION)));
  await pg.exec(readSql(ALLOCATION_FIELDS));
  await pg.exec(stripOuterMigrationTransaction(readSql(PLANT_MIGRATION)));
  return pg;
}
