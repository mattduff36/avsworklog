import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const { Client } = pg;

async function emergencyFix() {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL_NON_POOLING!,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected\n');
    console.log('🔄 EMERGENCY FIX: Dropping ALL policies...\n');

    const sql = readFileSync(join(process.cwd(), 'supabase', 'emergency-fix-all-policies.sql'), 'utf-8');
    await client.query(sql);
    
    console.log('✅ EMERGENCY FIX APPLIED!');
    console.log('   - Dropped ALL old SELECT policies');
    console.log('   - Created ONLY: users_view_own_profile');
    console.log('   - NO MORE RECURSION!');
    console.log('\n🔄 REFRESH YOUR BROWSER NOW!');

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

emergencyFix()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

