import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing database connection string');
  console.error(
    'Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local'
  );
  process.exit(1);
}

const SQL_FILE = 'supabase/migrations/20260212_view_as_effective_role.sql';

async function runMigration() {
  console.log('Running View-As Effective-Role Migration...\n');

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
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected!\n');

    // Read and execute migration
    const migrationSQL = readFileSync(resolve(process.cwd(), SQL_FILE), 'utf-8');

    console.log('Executing migration SQL...');
    await client.query(migrationSQL);
    console.log('Migration SQL executed!\n');

    // Verify helper functions exist
    const { rows: funcs } = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name IN (
          'view_as_role_id',
          'is_actual_super_admin',
          'effective_role_id',
          'effective_is_manager_admin',
          'effective_is_super_admin',
          'effective_has_role_name',
          'effective_has_module_permission'
        )
      ORDER BY routine_name;
    `);

    console.log('Helper functions verified:');
    for (const f of funcs) {
      console.log(`  - ${f.routine_name}`);
    }
    console.log(`  (${funcs.length}/7 found)\n`);

    if (funcs.length < 7) {
      console.error('WARNING: Not all helper functions were created!');
      process.exit(1);
    }

    // Quick sanity: count policies on one table
    const { rows: plantPolicies } = await client.query(`
      SELECT polname FROM pg_policy
      JOIN pg_class ON pg_policy.polrelid = pg_class.oid
      WHERE relname = 'plant'
      ORDER BY polname;
    `);
    console.log(`Plant table policies (${plantPolicies.length}):`);
    for (const p of plantPolicies) {
      console.log(`  - ${p.polname}`);
    }

    console.log('\nView-As Effective-Role migration completed successfully!\n');
  } catch (error: any) {
    console.error('\nMigration failed:');
    console.error(error.message || error);
    if (error.message?.includes('already exists')) {
      console.log('\nAlready applied – no action needed!');
      process.exit(0);
    }
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigration();
