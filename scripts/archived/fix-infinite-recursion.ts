// @ts-nocheck
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const { Client } = pg;

async function fix() {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL_NON_POOLING!,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const sql = readFileSync(join(process.cwd(), 'supabase', 'fix-infinite-recursion.sql'), 'utf-8');
    
    console.log('🔧 Fixing infinite recursion...\n');
    await client.query(sql);
    
    console.log('✅ FIXED! Infinite recursion removed!');
    console.log('   - Removed recursive profiles check');
    console.log('   - Using JWT metadata for admin check');
    console.log('   - App should work now!');

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

fix()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

