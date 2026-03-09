import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260309_fix_rls_vans_and_timesheet_entries.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running RLS fix migration (vans INSERT + timesheet_entries INSERT)...\n');

  const url = new URL(connectionString!);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);
    console.log('✅ Migration executed\n');

    const verifyResult = await client.query(`
      SELECT schemaname, tablename, policyname, cmd
      FROM pg_policies
      WHERE tablename IN ('vans', 'timesheet_entries')
      ORDER BY tablename, policyname;
    `);

    console.log('🔍 Current RLS policies for vans & timesheet_entries:');
    verifyResult.rows.forEach((row) => {
      console.log(`   [${row.tablename}] ${row.policyname} (${row.cmd})`);
    });

    const vansInsert = verifyResult.rows.some(
      (r) => r.tablename === 'vans' && r.cmd === 'INSERT'
    );
    const tsInsert = verifyResult.rows.filter(
      (r) => r.tablename === 'timesheet_entries' && r.cmd === 'INSERT'
    );

    console.log('');
    if (vansInsert) {
      console.log('✅ vans INSERT policy exists');
    } else {
      console.error('⚠️  vans INSERT policy NOT found');
    }
    if (tsInsert.length >= 2) {
      console.log(`✅ timesheet_entries INSERT policies exist (${tsInsert.length})`);
    } else {
      console.error(`⚠️  Expected 2 timesheet_entries INSERT policies, found ${tsInsert.length}`);
    }

    console.log('\n🎉 Migration complete!\n');
  } catch (err: unknown) {
    console.error('\n❌ Migration failed:');
    console.error(err);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
