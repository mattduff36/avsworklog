import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260126_error_reports.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🐛 Running Error Reports System Migration...\n');

  // Parse connection string with SSL config
  const url = new URL(connectionString);
  
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing error reports migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('🐛 Error Reports System Created:');
    
    console.log('\n1️⃣  error_reports Table:');
    console.log('   ✓ User-reported errors with status tracking');
    console.log('   ✓ Admin notes and resolution tracking');
    console.log('   ✓ Optional error codes and additional context');
    
    console.log('\n2️⃣  error_report_updates Table:');
    console.log('   ✓ Audit trail for status changes');
    console.log('   ✓ Admin activity tracking');
    
    console.log('\n3️⃣  RLS Policies:');
    console.log('   ✓ Users can view and create their own reports');
    console.log('   ✓ Admins can view and manage all reports');

    // Verify tables exist
    const tablesCheck = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('error_reports', 'error_report_updates')
      ORDER BY tablename;
    `);

    console.log(`\n✅ VERIFICATION: Found ${tablesCheck.rows.length} tables`);
    tablesCheck.rows.forEach(row => console.log(`   ✓ ${row.tablename}`));

    // Count policies
    const policyCount = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('error_reports', 'error_report_updates');
    `);

    console.log(`✅ VERIFICATION: ${policyCount.rows[0].count} RLS policies created\n`);

  } catch (error: any) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    
    if (error.message.includes('already exists')) {
      console.log('\n💡 TIP: Tables may already exist. Check if migration was previously run.');
    }
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
