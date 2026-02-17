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
-- Fix Actions Delete Policy
-- 
-- PROBLEM: Users (including SuperAdmins) cannot delete workshop tasks
-- CAUSE: Migration 20260212_view_as_effective_role.sql dropped the DELETE policy
--        but never recreated it
-- FIX: Add the missing DELETE policy for actions table
--
-- This policy allows managers/admins to delete workshop tasks

CREATE POLICY "Managers can delete actions" ON actions
FOR DELETE USING ( effective_is_manager_admin() );
`;

async function runMigration() {
  console.log('Running Fix Actions DELETE Policy Migration...\n');

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
      WHERE cls.relname = 'actions' AND pol.polcmd = 'd'
    `);

    if (before.rows.length > 0) {
      console.log('Current DELETE policy for actions:');
      before.rows.forEach(row => {
        console.log(`  Name:  ${row.polname}`);
        console.log(`  USING: ${row.policy_using}\n`);
      });
    } else {
      console.log('❌ No existing DELETE policy found for actions table (this is the bug!)\n');
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
      WHERE cls.relname = 'actions' AND pol.polcmd = 'd'
    `);

    if (after.rows.length > 0) {
      console.log('✅ Verification - DELETE policy now exists:');
      after.rows.forEach(row => {
        console.log(`  Name:  ${row.polname}`);
        console.log(`  USING: ${row.policy_using}\n`);
      });

      const policyText = after.rows[0].policy_using;
      if (policyText.includes('effective_is_manager_admin')) {
        console.log('✅ Policy correctly uses effective_is_manager_admin() - managers, admins, and super admins can delete actions.\n');
      } else {
        console.warn('⚠️  WARNING: Policy may not be using the expected function.\n');
      }
    } else {
      console.error('❌ ERROR: DELETE policy for actions not found after migration!\n');
      process.exit(1);
    }

    console.log('✅ Actions DELETE policy fix complete! Workshop tasks can now be deleted.\n');
  } catch (error: any) {
    // Check if the error is because the policy already exists
    if (error?.message?.includes('already exists')) {
      console.log('✅ Policy already exists - migration was previously applied successfully.\n');
      
      // Verify the policy is correct
      const check = await client.query(`
        SELECT pol.polname, pg_get_expr(pol.polqual, pol.polrelid) AS policy_using
        FROM pg_policy pol
        JOIN pg_class cls ON pol.polrelid = cls.oid
        WHERE cls.relname = 'actions' AND pol.polcmd = 'd'
      `);
      
      if (check.rows.length > 0) {
        console.log('Current DELETE policy:');
        check.rows.forEach(row => {
          console.log(`  Name:  ${row.polname}`);
          console.log(`  USING: ${row.policy_using}\n`);
        });
      }
      
      await client.end();
      console.log('Database connection closed');
      return;
    }

    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigration();
