/**
 * Script: Check RLS Auth Function Optimization
 * Purpose: Verify that all RLS policies use optimized auth function calls
 * 
 * This script checks if auth.uid() and auth.jwt() are properly wrapped in SELECT subqueries
 * for optimal performance (evaluated once per query vs once per row).
 */

import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const { Client } = pg;

async function checkRLSOptimization() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    console.error('❌ POSTGRES_URL_NON_POOLING not found in .env.local');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { 
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined 
    }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Check for unoptimized policies
    const unoptimizedQuery = `
      SELECT 
        schemaname,
        tablename,
        policyname,
        cmd,
        qual,
        with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (
          (qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%' AND qual NOT LIKE '%auth.uid()%'))%')
          OR (qual LIKE '%auth.jwt()%' AND qual NOT LIKE '%(select auth.jwt())%' AND qual NOT LIKE '%auth.jwt()%))%')
          OR (with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%' AND with_check NOT LIKE '%auth.uid()%))%')
          OR (with_check LIKE '%auth.jwt()%' AND with_check NOT LIKE '%(select auth.jwt())%' AND with_check NOT LIKE '%auth.jwt()%))%')
        )
      ORDER BY tablename, policyname;
    `;

    const result = await client.query(unoptimizedQuery);

    if (result.rows.length === 0) {
      console.log('✅ All RLS policies are optimized!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('All auth.uid() and auth.jwt() calls are properly wrapped');
      console.log('in SELECT subqueries for optimal performance.');
    } else {
      console.log(`⚠️  Found ${result.rows.length} unoptimized policies:\n`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      result.rows.forEach((row, index) => {
        console.log(`\n${index + 1}. Table: ${row.tablename}`);
        console.log(`   Policy: ${row.policyname}`);
        console.log(`   Command: ${row.cmd}`);
        
        if (row.qual) {
          const hasUnoptimizedUid = row.qual.includes('auth.uid()') && !row.qual.includes('(select auth.uid())');
          const hasUnoptimizedJwt = row.qual.includes('auth.jwt()') && !row.qual.includes('(select auth.jwt())');
          if (hasUnoptimizedUid) console.log('   ❌ USING clause contains unoptimized auth.uid()');
          if (hasUnoptimizedJwt) console.log('   ❌ USING clause contains unoptimized auth.jwt()');
        }
        
        if (row.with_check) {
          const hasUnoptimizedUid = row.with_check.includes('auth.uid()') && !row.with_check.includes('(select auth.uid())');
          const hasUnoptimizedJwt = row.with_check.includes('auth.jwt()') && !row.with_check.includes('(select auth.jwt())');
          if (hasUnoptimizedUid) console.log('   ❌ WITH CHECK clause contains unoptimized auth.uid()');
          if (hasUnoptimizedJwt) console.log('   ❌ WITH CHECK clause contains unoptimized auth.jwt()');
        }
      });

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Recommendation:');
      console.log('Run the optimization migration:');
      console.log('  supabase/migrations/20260121_optimize_rls_performance.sql');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

checkRLSOptimization();
