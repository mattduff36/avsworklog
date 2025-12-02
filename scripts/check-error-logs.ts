// Check error logs from database
// Run: npx tsx scripts/check-error-logs.ts

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

async function checkErrorLogs() {
  console.log('🔍 Checking Error Logs\n');

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
    console.log('✅ Connected to database\n');

    // Get recent error logs with user info
    const { rows: errors } = await client.query(`
      SELECT 
        e.id,
        e.timestamp,
        e.error_type,
        e.error_message,
        e.component_name,
        e.user_email,
        e.page_url,
        LEFT(e.user_agent, 30) as browser,
        p.full_name as user_name
      FROM error_logs e
      LEFT JOIN profiles p ON e.user_id = p.id
      ORDER BY e.timestamp DESC
      LIMIT 50;
    `);

    console.log('📋 Recent Errors (Last 50):');
    console.log('='.repeat(100));
    
    // Group by error message to see patterns
    const errorGroups: Record<string, { count: number; users: string[]; lastSeen: string }> = {};
    
    errors.forEach((err: any) => {
      const key = err.error_message.substring(0, 80);
      if (!errorGroups[key]) {
        errorGroups[key] = { count: 0, users: [], lastSeen: '' };
      }
      errorGroups[key].count++;
      if (err.user_name && !errorGroups[key].users.includes(err.user_name)) {
        errorGroups[key].users.push(err.user_name);
      }
      if (!errorGroups[key].lastSeen) {
        errorGroups[key].lastSeen = err.timestamp;
      }
    });

    console.log('\n📊 Error Summary (Grouped):');
    console.log('='.repeat(100));
    
    Object.entries(errorGroups)
      .sort((a, b) => b[1].count - a[1].count)
      .forEach(([msg, info]) => {
        console.log(`\n[${info.count}x] ${msg}...`);
        console.log(`    Last: ${new Date(info.lastSeen).toLocaleString()}`);
        console.log(`    Users: ${info.users.slice(0, 5).join(', ')}${info.users.length > 5 ? '...' : ''}`);
      });

    // Show detailed view of unique errors
    console.log('\n\n📝 Unique Error Types:');
    console.log('='.repeat(100));
    
    const uniqueErrors = new Map<string, any>();
    errors.forEach((err: any) => {
      const key = err.error_message.substring(0, 50);
      if (!uniqueErrors.has(key)) {
        uniqueErrors.set(key, err);
      }
    });

    uniqueErrors.forEach((err: any, key: string) => {
      console.log(`\n🔴 ${err.error_type || 'Error'}: ${err.component_name || 'Unknown Component'}`);
      console.log(`   Message: ${err.error_message}`);
      console.log(`   Page: ${err.page_url}`);
      console.log(`   User: ${err.user_name} (${err.user_email})`);
      console.log(`   Time: ${new Date(err.timestamp).toLocaleString()}`);
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkErrorLogs().catch(console.error);

