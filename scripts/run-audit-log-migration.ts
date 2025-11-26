import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Bypass SSL certificate verification for local development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function runMigration() {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL_NON_POOLING,
  });

  try {
    console.log('🔄 Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Read the SQL file
    const sqlPath = path.join(process.cwd(), 'supabase', 'enable-audit-log-access.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    console.log('🔄 Running migration: enable-audit-log-access.sql');
    console.log('📝 SQL Preview:');
    console.log(sql.substring(0, 200) + '...\n');

    // Execute the migration
    await client.query(sql);

    console.log('✅ Migration completed successfully!');
    console.log('\n📋 Summary:');
    console.log('  - Enabled RLS on audit_log table');
    console.log('  - Created policy for SuperAdmins to view audit logs');
    console.log('  - Created policy for Admins/Managers to view audit logs');
    console.log('  - Created policy for system to insert audit logs');
    console.log('\n🎉 Audit log access is now enabled!');

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    
    // Check for specific errors
    if (error.message.includes('already exists')) {
      console.log('\n⚠️  Note: Some objects may already exist. This is usually safe to ignore.');
    } else {
      console.error('\n📋 Full error:', error);
      process.exit(1);
    }
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the migration
runMigration();

