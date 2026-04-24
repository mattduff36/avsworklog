import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260424_allow_workshop_manager_plant_inspection_inserts.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Plant inspection insert policy fix...\n');

  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is not set in .env.local');
  }

  const databaseUrl: string = connectionString;
  const url = new URL(databaseUrl);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');

    console.log('📄 Updating plant inspection insert policy...');
    await client.query(migrationSQL);

    const { rows } = await client.query<{
      with_check: string | null;
    }>(`
      SELECT pg_get_expr(polwithcheck, polrelid) AS with_check
      FROM pg_policy
      WHERE polrelid = 'public.plant_inspections'::regclass
        AND polname = 'Managers can create plant inspections for users'
    `);

    const policyCheck = rows[0]?.with_check ?? '';
    if (!policyCheck.includes('effective_is_manager_admin')) {
      throw new Error('Updated policy is missing effective_is_manager_admin()');
    }

    if (policyCheck.includes('effective_is_workshop_team')) {
      throw new Error('Updated policy still blocks workshop managers');
    }

    console.log('✅ Plant inspection insert policy updated successfully.');
    console.log(`   WITH CHECK: ${policyCheck}`);
  } catch (error) {
    console.error('❌ Plant inspection insert policy migration failed.');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
