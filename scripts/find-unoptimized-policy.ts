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

async function findUnoptimized() {
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
    
    console.log('\n🔍 Finding Unoptimized RLS Policies\n');
    
    const unoptimized = await client.query(`
      SELECT 
        tablename,
        policyname,
        cmd,
        qual,
        with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (
          (qual ~* 'auth\\.(uid|jwt)\\(' AND qual !~* 'SELECT\\s+auth\\.(uid|jwt)\\(')
          OR (with_check ~* 'auth\\.(uid|jwt)\\(' AND with_check !~* 'SELECT\\s+auth\\.(uid|jwt)\\(')
        )
      ORDER BY tablename, policyname;
    `);
    
    if (unoptimized.rows.length === 0) {
      console.log('✅ All policies are optimized!');
    } else {
      console.log(`Found ${unoptimized.rows.length} unoptimized policy/policies:\n`);
      for (const row of unoptimized.rows) {
        console.log(`Table: ${row.tablename}`);
        console.log(`Policy: ${row.policyname}`);
        console.log(`Command: ${row.cmd}`);
        if (row.qual) {
          console.log(`USING: ${row.qual}`);
        }
        if (row.with_check) {
          console.log(`WITH CHECK: ${row.with_check}`);
        }
        console.log('\n---\n');
      }
    }
    
  } finally {
    await client.end();
  }
}

findUnoptimized();
