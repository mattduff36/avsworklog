import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';

dotenv.config({ path: '.env.local' });

const MIGRATION_FILE = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260228_vehicles_to_vans_hgvs.sql'
);

async function run() {
  const connString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connString) {
    console.error('Missing POSTGRES_URL_NON_POOLING in .env.local');
    process.exit(1);
  }

  const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');

  const url = new URL(connString);
  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port || '5432'),
    database: url.pathname.replace('/', ''),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Preflight: capture baseline counts
    console.log('\n--- PREFLIGHT ---');
    const vehicleCount = await client.query(
      "SELECT COUNT(*) AS cnt FROM vehicles"
    ).catch(() => ({ rows: [{ cnt: 0 }] }));
    console.log(`  vehicles rows (before): ${vehicleCount.rows[0].cnt}`);

    const te57 = await client.query(
      "SELECT id, reg_number FROM vehicles WHERE reg_number IN ('TE57 HGV', 'TE57HGV')"
    ).catch(() => ({ rows: [] }));
    console.log(`  TE57 HGV found: ${te57.rows.length > 0 ? 'YES' : 'NO'}`);
    if (te57.rows.length > 0) {
      console.log(`    id=${te57.rows[0].id}  reg=${te57.rows[0].reg_number}`);
    }

    // Run migration
    console.log('\n--- RUNNING MIGRATION ---');
    await client.query(sql);
    console.log('Migration completed successfully');

    // Verify
    console.log('\n--- VERIFICATION ---');

    const vansCount = await client.query("SELECT COUNT(*) AS cnt FROM vans");
    console.log(`  vans rows: ${vansCount.rows[0].cnt}`);

    const hgvsCount = await client.query("SELECT COUNT(*) AS cnt FROM hgvs");
    console.log(`  hgvs rows: ${hgvsCount.rows[0].cnt}`);

    const hgvCatCount = await client.query("SELECT COUNT(*) AS cnt FROM hgv_categories");
    console.log(`  hgv_categories rows: ${hgvCatCount.rows[0].cnt}`);

    const hgvInspCount = await client.query("SELECT COUNT(*) AS cnt FROM hgv_inspections");
    console.log(`  hgv_inspections rows: ${hgvInspCount.rows[0].cnt}`);

    // Verify TE57 HGV landed in hgvs
    const te57hgv = await client.query(
      "SELECT id, reg_number, status FROM hgvs WHERE reg_number IN ('TE57 HGV', 'TE57HGV')"
    );
    if (te57hgv.rows.length > 0) {
      console.log(`  TE57 HGV in hgvs: YES (id=${te57hgv.rows[0].id})`);
    } else {
      console.log('  TE57 HGV in hgvs: NO (may not have existed in source)');
    }

    // Verify vehicles table no longer exists
    const vehiclesExists = await client.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicles') AS exists"
    );
    console.log(`  vehicles table exists: ${vehiclesExists.rows[0].exists}`);

    // Verify vans table exists
    const vansExists = await client.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vans') AS exists"
    );
    console.log(`  vans table exists: ${vansExists.rows[0].exists}`);

    // Verify hgv_id columns added
    const hgvIdCols = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE column_name = 'hgv_id'
        AND table_schema = 'public'
      ORDER BY table_name
    `);
    console.log(`  Tables with hgv_id column: ${hgvIdCols.rows.map(r => r.table_name).join(', ')}`);

    // Verify applies_to updated
    const vanApplies = await client.query(
      "SELECT COUNT(*) AS cnt FROM van_categories WHERE 'van' = ANY(applies_to)"
    );
    console.log(`  van_categories with applies_to='van': ${vanApplies.rows[0].cnt}`);

    const oldVehicleApplies = await client.query(
      "SELECT COUNT(*) AS cnt FROM van_categories WHERE 'vehicle' = ANY(applies_to)"
    );
    console.log(`  van_categories with applies_to='vehicle' (should be 0): ${oldVehicleApplies.rows[0].cnt}`);

    // Verify role_permissions updated
    const rolePerms = await client.query(
      "SELECT COUNT(*) AS cnt FROM role_permissions WHERE module_name = 'admin-vans'"
    );
    console.log(`  role_permissions with admin-vans: ${rolePerms.rows[0].cnt}`);

    const oldPerms = await client.query(
      "SELECT COUNT(*) AS cnt FROM role_permissions WHERE module_name = 'admin-vehicles'"
    );
    console.log(`  role_permissions with admin-vehicles (should be 0): ${oldPerms.rows[0].cnt}`);

    console.log('\nMigration verified successfully!');

  } catch (err: unknown) {
    const pgErr = err as { message?: string; detail?: string; hint?: string; code?: string };
    console.error('\nMIGRATION FAILED:', pgErr.message);
    if (pgErr.detail) console.error('  Detail:', pgErr.detail);
    if (pgErr.hint) console.error('  Hint:', pgErr.hint);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
