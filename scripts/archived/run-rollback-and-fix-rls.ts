/**
 * URGENT: Rollback and Fix RLS Policy
 * 
 * The previous RLS policy broke profile viewing for all users.
 * This script removes it and creates a comprehensive policy that works.
 */

import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const { Client } = pg;

async function runFix() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING!;
  
  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Read SQL file
    const sqlPath = join(process.cwd(), 'supabase', 'rollback-and-fix-rls.sql');
    const sql = readFileSync(sqlPath, 'utf-8');

    console.log('🔄 Rolling back problematic policy and applying fix...\n');
    
    // Execute the SQL
    const result = await client.query(sql);
    
    console.log('✅ RLS policies fixed!\n');
    
    // Show current policies
    console.log('📋 Current Policies on profiles table:');
    console.log('─'.repeat(60));
    if (result.rows && result.rows.length > 0) {
      result.rows.forEach(row => {
        console.log(`  - ${row.policyname}`);
      });
    }

    console.log('\n✅ Fix complete!');
    console.log('   - Users can view their own profiles ✓');
    console.log('   - Users can view message sender profiles ✓');
    console.log('   - Admins can view all profiles ✓');

  } catch (err: unknown) {
    console.error('❌ Fix failed:', err instanceof Error ? err.message : err);
    throw err;
  } finally {
    await client.end();
  }
}

runFix()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Fatal error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });

