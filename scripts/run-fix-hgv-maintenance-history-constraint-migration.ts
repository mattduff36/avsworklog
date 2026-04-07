import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260407_fix_hgv_maintenance_history_constraint.sql';

async function runMigration() {
  console.log('🚀 Running HGV maintenance_history constraint fix migration\n');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in .env.local');
    process.exit(1);
  }

  const migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
  const url = new URL(connectionString);

  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');

    console.log(`📝 Executing migration from ${MIGRATION_FILE}...`);
    await client.query(migrationSQL);
    console.log('✅ Migration executed successfully\n');

    const constraintCheck = await client.query(`
      SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'maintenance_history'
        AND con.contype = 'c'
      ORDER BY con.conname;
    `);

    const hasLegacyConstraint = constraintCheck.rows.some((row) => row.conname === 'check_van_or_plant');
    const assetConstraint = constraintCheck.rows.find((row) => row.conname === 'check_maintenance_history_asset');

    if (hasLegacyConstraint) {
      throw new Error('Legacy constraint check_van_or_plant still exists');
    }

    if (!assetConstraint?.definition?.includes('num_nonnulls(van_id, hgv_id, plant_id) = 1')) {
      throw new Error('Updated check_maintenance_history_asset constraint not found');
    }

    const backfillCheck = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM public.maintenance_history
      WHERE hgv_id IS NOT NULL;
    `);

    console.log('✅ Legacy constraint removed');
    console.log('✅ HGV-capable asset constraint verified');
    console.log(`✅ HGV maintenance history rows now present: ${backfillCheck.rows[0].count}`);
  } catch (error) {
    console.error('❌ Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

runMigration().catch((error) => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
