import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function inspectProfilesRLS() {
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
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Get all policies on profiles table
    const result = await client.query(`
      SELECT 
        policyname,
        cmd,
        qual,
        with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profiles'
      ORDER BY policyname;
    `);

    if (result.rows.length === 0) {
      console.log('❌ No policies found on profiles table');
      return;
    }

    console.log(`Found ${result.rows.length} policies on profiles table:\n`);

    result.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.policyname} (${row.cmd})`);
      
      if (row.qual) {
        console.log('   USING clause:');
        const isOptimized = row.qual.includes('(select auth.uid())') || row.qual.includes('(select auth.jwt())');
        const hasAuthFunction = row.qual.includes('auth.uid()') || row.qual.includes('auth.jwt()');
        
        if (hasAuthFunction && !isOptimized) {
          console.log('   ❌ UNOPTIMIZED - Contains bare auth.uid() or auth.jwt()');
        } else if (isOptimized) {
          console.log('   ✅ OPTIMIZED - Uses (select auth.uid()) or (select auth.jwt())');
        }
        console.log(`   ${row.qual.slice(0, 200)}${row.qual.length > 200 ? '...' : ''}`);
      }
      
      if (row.with_check) {
        console.log('   WITH CHECK clause:');
        const isOptimized = row.with_check.includes('(select auth.uid())') || row.with_check.includes('(select auth.jwt())');
        const hasAuthFunction = row.with_check.includes('auth.uid()') || row.with_check.includes('auth.jwt()');
        
        if (hasAuthFunction && !isOptimized) {
          console.log('   ❌ UNOPTIMIZED - Contains bare auth.uid() or auth.jwt()');
        } else if (isOptimized) {
          console.log('   ✅ OPTIMIZED - Uses (select auth.uid()) or (select auth.jwt())');
        }
        console.log(`   ${row.with_check.slice(0, 200)}${row.with_check.length > 200 ? '...' : ''}`);
      }
      
      console.log('');
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

inspectProfilesRLS();
