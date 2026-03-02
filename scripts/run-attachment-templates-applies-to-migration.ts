import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260204_add_attachment_templates_applies_to.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Attachment Templates applies_to Migration...\n');

  const url = new URL(connectionString!);
  
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

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');

    // Verify migration
    const verifyResult = await client.query(`
      SELECT name, applies_to, is_active
      FROM workshop_attachment_templates
      ORDER BY name
      LIMIT 10;
    `);

    console.log('🔍 Sample attachment templates with applies_to:');
    verifyResult.rows.forEach((row) => {
      console.log(`   - ${row.name}: applies_to=[${row.applies_to.join(', ')}], active=${row.is_active}`);
    });

    console.log('\n🎉 Attachment templates applies_to migration complete!\n');

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
