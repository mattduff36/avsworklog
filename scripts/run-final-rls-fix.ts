import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260121_fix_final_rls_policy.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('🔧 Fixing Final Unoptimized RLS Policy...\n');

  const url = new URL(connectionString);
  
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    
    console.log('📄 Executing fix...');
    await client.query(migrationSQL);
    
    console.log('✅ Fix applied successfully!\n');

  } catch (error: any) {
    console.error('\n❌ Fix failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
