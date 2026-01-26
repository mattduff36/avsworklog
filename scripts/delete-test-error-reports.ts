import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function deleteTestErrorReports() {
  console.log('🗑️  Deleting test error reports...\n');

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

    // First, find all test error reports
    console.log('🔍 Finding test error reports...');
    const findResult = await client.query(`
      SELECT id, title, created_at, status
      FROM error_reports
      WHERE LOWER(title) LIKE '%test%'
      ORDER BY created_at DESC
    `);

    const testReports = findResult.rows;
    
    if (testReports.length === 0) {
      console.log('✅ No test error reports found.');
      return;
    }

    console.log(`📋 Found ${testReports.length} test error report(s):\n`);
    testReports.forEach((report, index) => {
      console.log(`  ${index + 1}. ${report.title} (${report.status}) - Created: ${new Date(report.created_at).toLocaleString()}`);
    });
    console.log('');

    // Delete the test error reports
    // Note: error_report_updates will be automatically deleted due to ON DELETE CASCADE
    console.log('🗑️  Deleting test error reports...');
    const deleteResult = await client.query(`
      DELETE FROM error_reports
      WHERE LOWER(title) LIKE '%test%'
      RETURNING id, title
    `);

    const deletedCount = deleteResult.rows.length;
    console.log(`✅ Successfully deleted ${deletedCount} test error report(s).\n`);

    // Verify deletion
    const verifyResult = await client.query(`
      SELECT COUNT(*) as count
      FROM error_reports
      WHERE LOWER(title) LIKE '%test%'
    `);

    const remainingCount = parseInt(verifyResult.rows[0].count);
    if (remainingCount === 0) {
      console.log('✅ Verification: All test error reports have been deleted.');
    } else {
      console.log(`⚠️  Warning: ${remainingCount} test error report(s) still remain.`);
    }

  } catch (error) {
    console.error('❌ Error deleting test error reports:', error);
    throw error;
  } finally {
    await client.end();
    console.log('\n📡 Database connection closed.');
  }
}

// Run the script
deleteTestErrorReports()
  .then(() => {
    console.log('\n✅ Script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
