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

async function checkOptimization() {
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
    
    console.log('\n📊 Checking RLS Policy Optimization Status\n');
    
    // Sample a few policies to see their current state
    const sample = await client.query(`
      SELECT 
        tablename,
        policyname,
        qual,
        with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (qual LIKE '%auth.uid()%' OR qual LIKE '%auth.jwt()%'
            OR with_check LIKE '%auth.uid()%' OR with_check LIKE '%auth.jwt()%')
      ORDER BY tablename
      LIMIT 5;
    `);
    
    console.log('Sample policies:\n');
    for (const row of sample.rows) {
      console.log(`Table: ${row.tablename}`);
      console.log(`Policy: ${row.policyname}`);
      if (row.qual) {
        console.log(`USING: ${row.qual.substring(0, 100)}${row.qual.length > 100 ? '...' : ''}`);
      }
      if (row.with_check) {
        console.log(`WITH CHECK: ${row.with_check.substring(0, 100)}${row.with_check.length > 100 ? '...' : ''}`);
      }
      console.log('');
    }
    
    // Check if optimization was applied
    // Postgres formats the subquery as "( SELECT auth.uid() AS uid)" so we look for "SELECT auth."
    const optimized = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (
          qual ~* 'SELECT\\s+auth\\.(uid|jwt)\\('
          OR with_check ~* 'SELECT\\s+auth\\.(uid|jwt)\\('
        );
    `);
    
    console.log(`✅ Optimized policies (using SELECT auth.*): ${optimized.rows[0].count}`);
    
    const unoptimized = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (
          (qual ~* 'auth\\.(uid|jwt)\\(' AND qual !~* 'SELECT\\s+auth\\.(uid|jwt)\\(')
          OR (with_check ~* 'auth\\.(uid|jwt)\\(' AND with_check !~* 'SELECT\\s+auth\\.(uid|jwt)\\(')
        );
    `);
    
    console.log(`⚠️  Unoptimized policies (direct auth.* calls): ${unoptimized.rows[0].count}\n`);
    
  } finally {
    await client.end();
  }
}

checkOptimization();
