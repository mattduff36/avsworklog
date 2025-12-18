import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const { Client } = pg;

async function restoreAccess() {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL_NON_POOLING!,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected\n');

    const sql = readFileSync(join(process.cwd(), 'supabase', 'restore-profile-access.sql'), 'utf-8');
    await client.query(sql);
    
    console.log('✅ PROFILE ACCESS RESTORED!');
    console.log('   - Roles table: RLS disabled (public data)');
    console.log('   - Profiles: All users can view all profiles');
    console.log('   - NO recursion (roles has no RLS)');
    console.log('\n🎉 APP SHOULD BE FULLY WORKING NOW!');
    console.log('\n🔄 HARD REFRESH YOUR BROWSER (Ctrl+F5 / Cmd+Shift+R)');

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

restoreAccess()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

