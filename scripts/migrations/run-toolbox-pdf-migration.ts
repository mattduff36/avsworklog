// @ts-nocheck
/**
 * Migration runner: Add PDF attachment support to Toolbox Talk messages
 * Adds pdf_file_path column to messages table
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import * as fs from 'fs';

const { Client } = pg;

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string:');
  console.error('   - POSTGRES_URL_NON_POOLING (preferred)');
  console.error('   - POSTGRES_URL (fallback)');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Toolbox Talk PDF Migration...\n');

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

    // Read SQL file
    const sqlPath = resolve(process.cwd(), 'supabase', 'add-pdf-to-toolbox-talks.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    console.log('📄 Executing migration SQL...');
    await client.query(sql);
    console.log('✅ Migration executed successfully\n');

    // Verify the column was added
    console.log('🔍 Verifying migration...');
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'messages'
      AND column_name = 'pdf_file_path';
    `);

    if (result.rows.length > 0) {
      console.log('✅ Column "pdf_file_path" verified in messages table');
      console.log(`   Type: ${result.rows[0].data_type}`);
      console.log(`   Nullable: ${result.rows[0].is_nullable}\n`);
    } else {
      console.log('⚠️  Warning: Column not found after migration\n');
    }

    console.log('━'.repeat(80));
    console.log('✨ Migration complete!');
    console.log('━'.repeat(80));
    console.log('✅ Toolbox Talk messages can now have optional PDF attachments\n');

  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      console.log('✅ Column already exists - migration previously completed\n');
    } else {
      console.error('❌ Migration failed:', error.message);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

runMigration();

