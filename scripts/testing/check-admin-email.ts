import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

async function checkAdminEmails() {
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
    
    console.log('Checking admin user emails:\n');
    
    const { rows } = await client.query(`
      SELECT p.id, p.full_name, p.role, u.email
      FROM profiles p
      INNER JOIN auth.users u ON u.id = p.id
      WHERE p.role = 'admin'
      ORDER BY p.full_name
    `);
    
    console.log('All admin users:');
    rows.forEach(row => {
      console.log(`  - ${row.full_name}: ${row.email}`);
    });
    
    console.log('\n\nCurrent super admin:');
    const { rows: superAdmin } = await client.query(`
      SELECT p.full_name, u.email, r.is_super_admin
      FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      INNER JOIN auth.users u ON u.id = p.id
      WHERE r.is_super_admin = TRUE
    `);
    
    if (superAdmin.length > 0) {
      superAdmin.forEach(row => {
        console.log(`  ✅ ${row.full_name}: ${row.email}`);
      });
    } else {
      console.log('  ⚠️  No super admin set');
    }
    
  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

checkAdminEmails();

