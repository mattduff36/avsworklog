import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260122_fix_workshop_attachment_cascade.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('🔧 Fixing Workshop Attachment Question Cascade Delete...\n');

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
    await client.connect();
    console.log('✅ Connected to database\n');

    // Check current constraint
    const before = await client.query(`
      SELECT pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conname = 'workshop_attachment_responses_question_id_fkey';
    `);

    if (before.rows.length > 0) {
      console.log('📊 Current constraint:');
      console.log(`   ${before.rows[0].definition}`);
      console.log('');
    }

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    await client.query(migrationSQL);

    console.log('✅ Migration completed!\n');
    
    // Verify the constraint now has CASCADE
    const after = await client.query(`
      SELECT pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conname = 'workshop_attachment_responses_question_id_fkey';
    `);

    if (after.rows.length > 0) {
      const def = after.rows[0].definition;
      console.log('📊 Updated constraint:');
      console.log(`   ${def}`);
      console.log('');
      
      if (def.includes('ON DELETE CASCADE')) {
        console.log('   ✅ Cascade delete successfully added!');
      } else {
        console.log('   ⚠️  Cascade delete may not be present');
      }
    }

    console.log('\n🎯 Impact:');
    console.log('   • Users can now delete attachment template questions');
    console.log('   • Associated responses will be automatically cleaned up');
    console.log('   • No more foreign key constraint violations');

  } catch (error: any) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

runMigration();
