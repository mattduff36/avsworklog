import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

async function checkSchema() {
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
    
    console.log('Checking profiles table structure:\n');
    
    const { rows } = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles'
      ORDER BY ordinal_position
    `);
    
    console.log('Columns in profiles table:');
    rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });
    
    // Check if there's an auth.users table
    console.log('\n\nChecking auth.users table:\n');
    const { rows: authRows } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users'
      ORDER BY ordinal_position
      LIMIT 10
    `);
    
    if (authRows.length > 0) {
      console.log('Auth users table exists with columns:');
      authRows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type}`);
      });
    }
    
    // Check for admin user
    console.log('\n\nLooking for admin user:\n');
    const { rows: adminRows } = await client.query(`
      SELECT id, full_name, role
      FROM profiles
      WHERE role = 'admin'
      LIMIT 5
    `);
    
    console.log('Admin users found:');
    adminRows.forEach(row => {
      console.log(`  - ${row.id}: ${row.full_name} (${row.role})`);
    });
    
  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

checkSchema();

