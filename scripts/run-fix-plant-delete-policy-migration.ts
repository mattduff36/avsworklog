import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

const MIGRATION_SQL = `
-- Fix plant DELETE RLS policy: allow managers and admins (not just super admins)
DROP POLICY IF EXISTS "plant_delete_policy" ON plant;

CREATE POLICY "plant_delete_policy"
ON plant FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid()
    AND r.is_manager_admin = true
  )
);
`;

async function runMigration() {
  console.log('Running Fix Plant DELETE Policy Migration...\n');

  const url = new URL(connectionString!);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
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
    console.log('Connected!\n');

    // Check current policy before migration
    const before = await client.query(`
      SELECT pol.polname, pg_get_expr(pol.polqual, pol.polrelid) AS policy_using
      FROM pg_policy pol
      JOIN pg_class cls ON pol.polrelid = cls.oid
      WHERE cls.relname = 'plant' AND pol.polname = 'plant_delete_policy'
    `);

    if (before.rows.length > 0) {
      console.log('Current DELETE policy:');
      console.log(`  Name:  ${before.rows[0].polname}`);
      console.log(`  USING: ${before.rows[0].policy_using}\n`);
    } else {
      console.log('No existing plant_delete_policy found (will create fresh)\n');
    }

    // Execute migration
    console.log('Applying migration...');
    await client.query(MIGRATION_SQL);
    console.log('Migration applied!\n');

    // Verify after migration
    const after = await client.query(`
      SELECT pol.polname, pg_get_expr(pol.polqual, pol.polrelid) AS policy_using
      FROM pg_policy pol
      JOIN pg_class cls ON pol.polrelid = cls.oid
      WHERE cls.relname = 'plant' AND pol.polname = 'plant_delete_policy'
    `);

    if (after.rows.length > 0) {
      const policyText = after.rows[0].policy_using;
      console.log('Verification:');
      console.log(`  Name:  ${after.rows[0].polname}`);
      console.log(`  USING: ${policyText}\n`);

      if (policyText.includes('is_manager_admin')) {
        console.log('Policy correctly uses is_manager_admin - managers and admins can delete plant records.\n');
      } else if (policyText.includes('is_super_admin')) {
        console.error('WARNING: Policy still uses is_super_admin - migration may not have applied correctly.\n');
        process.exit(1);
      }
    } else {
      console.error('ERROR: plant_delete_policy not found after migration!\n');
      process.exit(1);
    }

    console.log('Plant DELETE policy fix complete!\n');
  } catch (error) {
    console.error('\nMigration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigration();
