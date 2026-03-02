// @ts-nocheck
/**
 * Fix Message Sender RLS Policy
 * 
 * This script adds an RLS policy to allow users to view the profiles
 * of people who have sent them messages (Toolbox Talks/Reminders).
 */

import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const { Client } = pg;

async function runMigration() {
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
    const sqlPath = join(process.cwd(), 'supabase', 'fix-message-sender-rls.sql');
    const sql = readFileSync(sqlPath, 'utf-8');

    console.log('📝 Executing RLS policy fix...\n');
    
    // Execute the SQL
    const result = await client.query(sql);
    
    console.log('✅ RLS policy created successfully!\n');
    
    // Show the result
    if (result.rows && result.rows.length > 0) {
      console.log('📋 Policy Details:');
      console.log('─'.repeat(60));
      result.rows.forEach(row => {
        console.log(`  Policy Name: ${row.policyname}`);
        console.log(`  Table: ${row.tablename}`);
        console.log(`  Command: ${row.cmd}`);
        console.log('');
      });
    }

    console.log('✅ Migration complete!');
    console.log('\n📝 What this does:');
    console.log('   - Employees can now see the names of managers/admins who send them messages');
    console.log('   - The "Deleted User" issue in notifications should be fixed');
    console.log('   - RLS security is maintained - users still can\'t see all profiles');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

