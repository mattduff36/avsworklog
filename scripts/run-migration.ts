import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

// Extract project ref from URL and build connection string
const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
const connectionString = `postgresql://postgres.${projectRef}:${serviceRoleKey}@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;

async function runMigration() {
  console.log('🚀 Running database migration...\n');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('📡 Connecting to Supabase database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read the migration SQL file
    const migrationSQL = readFileSync(
      resolve(process.cwd(), 'supabase/migrate-inspections.sql'),
      'utf-8'
    );

    console.log('📄 Migration file loaded');
    console.log('🔄 Executing SQL migration...\n');

    // Execute the migration (PostgreSQL can handle multiple statements)
    await client.query(migrationSQL);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('📊 Database changes applied:');
    console.log('   ✓ vehicle_inspections: week_ending → inspection_date');
    console.log('   ✓ vehicle_inspections: status updated (draft/submitted/approved/rejected)');
    console.log('   ✓ inspection_items: recreated with new structure');
    console.log('   ✓ inspection_items: removed day_of_week column');
    console.log('   ✓ inspection_items: added item_description & comments');
    console.log('   ✓ inspection_items: simplified status (ok/defect)');
    console.log('   ✓ RLS policies updated for both tables\n');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Ready to test!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('🎉 You can now use the forms:');
    console.log('   • Timesheet: http://localhost:3000/timesheets/new');
    console.log('   • Vehicle Inspection: http://localhost:3000/inspections/new\n');

  } catch (error: any) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MIGRATION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('Error:', error.message);
    if (error.detail) {
      console.error('Details:', error.detail);
    }
    if (error.hint) {
      console.error('Hint:', error.hint);
    }
    console.log('\n📝 You can run the migration manually:');
    console.log('   1. Go to: https://supabase.com/dashboard/project/lrhufzqfzeutgvudcowy');
    console.log('   2. Click "SQL Editor" → "New query"');
    console.log('   3. Copy & paste contents of: supabase/migrate-inspections.sql');
    console.log('   4. Click "Run"\n');
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

