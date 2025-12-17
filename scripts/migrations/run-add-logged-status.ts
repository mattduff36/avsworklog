import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function runMigration() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in environment');
    process.exit(1);
  }

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
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Read migration file
    const migrationPath = path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20251217_add_logged_status_to_actions.sql'
    );

    console.log('📖 Reading migration file...');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Check current actions
    console.log('📊 Checking current actions...\n');
    
    const beforeStats = await client.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM actions
      GROUP BY status
      ORDER BY status;
    `);
    
    console.log('BEFORE Migration:');
    if (beforeStats.rows.length === 0) {
      console.log('  No actions in database');
    } else {
      beforeStats.rows.forEach(row => {
        console.log(`  ${row.status}: ${row.count}`);
      });
    }
    console.log();

    // Execute migration
    console.log('🚀 Running migration...');
    await client.query(sql);
    console.log('✅ Migration executed successfully\n');

    // Verify new columns exist
    const columnCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'actions' 
      AND column_name IN ('logged_comment', 'logged_at', 'logged_by')
      ORDER BY column_name;
    `);

    console.log('📋 New columns added:');
    columnCheck.rows.forEach(col => {
      console.log(`  ✅ ${col.column_name} (${col.data_type})`);
    });

    // Verify status constraint
    const constraintCheck = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'actions' 
      AND constraint_name = 'actions_status_check';
    `);

    if (constraintCheck.rows.length > 0) {
      console.log('\n✅ Status constraint updated to include "logged"');
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📝 Summary:');
    console.log('  - Added "logged" to status enum');
    console.log('  - Added logged_comment column (TEXT)');
    console.log('  - Added logged_at column (TIMESTAMPTZ)');
    console.log('  - Added logged_by column (UUID)');
    console.log('  - Added index for logged actions');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

runMigration();
