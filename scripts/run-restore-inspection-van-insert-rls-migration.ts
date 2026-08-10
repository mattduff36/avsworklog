import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const configuredConnectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260810_restore_inspection_van_insert_rls.sql';

if (!configuredConnectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING is set in .env.local');
  process.exit(1);
}

const connectionString: string = configuredConnectionString;

function hasFleetLevel4Check(expression: string): boolean {
  return /effective_has_module_level\s*\(\s*'admin-vans'(?:::\w+)?\s*,\s*4\s*\)/i.test(
    expression
  );
}

function hasVanApplicableCategoryCheck(expression: string): boolean {
  return /'(?:van|vehicle)'(?:::\w+)?\s*=\s*ANY\s*\([^)]*applies_to[^)]*\)/i.test(
    expression
  );
}

async function runMigration() {
  console.log('Running inspection van INSERT RLS restore migration...\n');

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected.\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    console.log('Executing migration...');
    await client.query(migrationSQL);
    console.log('Migration executed.\n');

    const policyResult = await client.query<{
      policyname: string;
      cmd: string;
      with_check: string | null;
      qual: string | null;
      permissive: string;
    }>(
      `
        SELECT policyname, cmd, with_check, qual, permissive
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'vans'
        ORDER BY policyname
      `
    );

    console.log('Current vans policies:');
    for (const row of policyResult.rows) {
      console.log(`  [${row.cmd}] ${row.policyname} (${row.permissive})`);
    }

    const insertPolicy = policyResult.rows.find(
      (row) => row.policyname === 'Users can add vans' && row.cmd === 'INSERT'
    );
    if (!insertPolicy) {
      throw new Error('Users can add vans INSERT policy was not found after migration');
    }
    const withCheck = insertPolicy.with_check ?? '';
    if (!withCheck.includes('effective_has_module_permission') || !withCheck.includes('inspections')) {
      throw new Error('INSERT policy does not allow inspection-module creators');
    }
    if (!hasFleetLevel4Check(withCheck)) {
      throw new Error('INSERT policy does not retain Fleet Level 4 insert access');
    }
    if (!withCheck.includes('COALESCE(asset_type') || !withCheck.includes('vehicle')) {
      throw new Error('INSERT policy is missing inspection row-shape constraints');
    }
    if (!withCheck.includes("status = 'active'") && !withCheck.includes("status = 'active'::text")) {
      throw new Error('INSERT policy is missing active-status constraint for inspection inserts');
    }
    if (
      !withCheck.includes('van_categories') ||
      !hasVanApplicableCategoryCheck(withCheck)
    ) {
      throw new Error('INSERT policy is missing van-applicable category constraint');
    }

    const updatePolicy = policyResult.rows.find(
      (row) => row.policyname === 'Managers can update vehicles' && row.cmd === 'UPDATE'
    );
    const deletePolicy = policyResult.rows.find(
      (row) => row.policyname === 'Managers can delete vehicles' && row.cmd === 'DELETE'
    );
    const updateQual = updatePolicy?.qual ?? '';
    const deleteQual = deletePolicy?.qual ?? '';
    if (!updatePolicy || !hasFleetLevel4Check(updateQual)) {
      throw new Error('UPDATE policy is not restricted to Fleet Level 4');
    }
    if (!deletePolicy || !hasFleetLevel4Check(deleteQual)) {
      throw new Error('DELETE policy is not restricted to Fleet Level 4');
    }

    const updatePolicies = policyResult.rows.filter((row) => row.cmd === 'UPDATE');
    const deletePolicies = policyResult.rows.filter((row) => row.cmd === 'DELETE');
    if (updatePolicies.length !== 1 || updatePolicies[0]?.policyname !== 'Managers can update vehicles') {
      throw new Error(
        `Unexpected vans UPDATE policies: ${updatePolicies.map((row) => row.policyname).join(', ') || '(none)'}`
      );
    }
    if (deletePolicies.length !== 1 || deletePolicies[0]?.policyname !== 'Managers can delete vehicles') {
      throw new Error(
        `Unexpected vans DELETE policies: ${deletePolicies.map((row) => row.policyname).join(', ') || '(none)'}`
      );
    }
    if (updatePolicies.some((row) => !hasFleetLevel4Check(row.qual ?? ''))) {
      throw new Error('A permissive vans UPDATE policy is not restricted to Fleet Level 4');
    }
    if (deletePolicies.some((row) => !hasFleetLevel4Check(row.qual ?? ''))) {
      throw new Error('A permissive vans DELETE policy is not restricted to Fleet Level 4');
    }

    const permissiveAll = policyResult.rows.filter(
      (row) => row.cmd === 'ALL' && row.permissive === 'PERMISSIVE'
    );
    if (permissiveAll.length > 0) {
      throw new Error(
        `Unexpected permissive FOR ALL vans policy: ${permissiveAll.map((row) => row.policyname).join(', ')}`
      );
    }

    console.log('\nSuccess: constrained inspection/fleet vans INSERT policy installed.\n');
    console.log('Verified UPDATE/DELETE remain Fleet Level 4 only.\n');
  } catch (err) {
    console.error('Migration failed:');
    console.error(err);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

void runMigration();
