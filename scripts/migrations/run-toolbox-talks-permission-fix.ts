import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260304_disable_toolbox_talks_for_non_admin_roles.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function run() {
  console.log('🚀 Disabling toolbox-talks for non-admin roles...\n');

  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected\n');

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    const result = await client.query(sql);

    const rowCount = result.rowCount ?? 0;
    console.log(`✅ Updated ${rowCount} role_permissions row(s)`);

    const { rows } = await client.query(`
      SELECT r.display_name, rp.enabled
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      WHERE rp.module_name = 'toolbox-talks'
      ORDER BY r.is_super_admin DESC, r.is_manager_admin DESC, r.name
    `);

    console.log('\nToolbox Talks permissions after migration:');
    rows.forEach((row: { display_name: string; enabled: boolean }) => {
      console.log(`  ${row.enabled ? '✅' : '❌'} ${row.display_name}`);
    });

    console.log('\n✅ Done');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
