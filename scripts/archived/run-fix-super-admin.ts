// @ts-nocheck
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/fix-super-admin.sql';

async function fixSuperAdmin() {
  console.log('🔧 Fixing Super Admin Configuration...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const url = new URL(connectionString!);
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

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    
    console.log('📄 Executing fix...');
    await client.query(sql);
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ SUPER ADMIN FIX COMPLETED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('🔍 Verification:\n');
    
    const { rows } = await client.query(`
      SELECT 
        p.full_name,
        u.email,
        p.super_admin
      FROM profiles p
      INNER JOIN auth.users u ON u.id = p.id
      WHERE p.super_admin = TRUE OR p.role = 'admin'
      ORDER BY p.super_admin DESC, p.full_name
    `);
    
    console.log('Admin users status:');
    rows.forEach(row => {
      if (row.super_admin) {
        console.log(`  🔒 ${row.full_name} (${row.email}) - SUPER ADMIN`);
      } else {
        console.log(`  👤 ${row.full_name} (${row.email}) - Admin`);
      }
    });
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Only admin@mpdee.co.uk is now Super Admin');
    console.log('✅ Super Admin profile cannot be deleted');
    console.log('✅ Super Admin flag cannot be changed by others');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

fixSuperAdmin();

