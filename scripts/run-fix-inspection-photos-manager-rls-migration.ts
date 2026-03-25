import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260325_fix_inspection_photos_manager_rls.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('📸 Running inspection_photos manager RLS fix...\n');

  const url = new URL(connectionString!);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    console.log(`📄 Executing ${sqlFile}...`);
    await client.query(migrationSQL);
    console.log(`✅ Migration executed!\n`);

    const policyCheck = await client.query(`
      SELECT policyname, cmd, permissive
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'inspection_photos'
      ORDER BY policyname;
    `);
    console.log(`── inspection_photos policies (${policyCheck.rows.length}) ──`);
    for (const row of policyCheck.rows) {
      console.log(`   • ${row.policyname}  (${row.cmd}, ${row.permissive})`);
    }

    console.log('\n🎉 Done!\n');

  } catch (err: unknown) {
    console.error('\n❌ Migration failed:');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
