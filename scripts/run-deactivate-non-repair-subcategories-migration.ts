/**
 * Migration Runner: Deactivate non-Repair subcategories
 *
 * Deactivates all subcategories not under "Repair (Vehicle)", and migrates
 * existing actions to clear their workshop_subcategory_id, preserving
 * workshop_category_id.
 *
 * Usage: npx tsx scripts/run-deactivate-non-repair-subcategories-migration.ts
 */

import { config } from 'dotenv';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

config({ path: '.env.local' });

const { Client } = pg;

async function runMigration() {
  console.log('🚀 Starting deactivate-non-repair-subcategories migration\n');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not found in environment');
  }

  const url = new URL(connectionString!);

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
    console.log('✅ Connected to database\n');

    // Step 1: Run the SQL migration
    console.log('📝 Step 1: Running SQL migration...');
    const sqlPath = join(
      process.cwd(),
      'supabase/migrations/20260217_deactivate_non_repair_subcategories.sql'
    );
    const sql = readFileSync(sqlPath, 'utf-8');
    await client.query(sql);
    console.log('   ✅ SQL migration complete\n');

    // Step 2: Verify Repair (Vehicle) subcategories are still active
    console.log('📝 Step 2: Checking Repair (Vehicle) subcategories...');
    const repairSubs = await client.query(`
      SELECT s.name, s.is_active
      FROM workshop_task_subcategories s
      INNER JOIN workshop_task_categories c ON s.category_id = c.id
      WHERE c.slug = 'repair' AND c.applies_to = 'van'
      ORDER BY s.name
    `);
    for (const sub of repairSubs.rows) {
      const flag = sub.is_active ? '✅ Active' : '⬜ Inactive';
      console.log(`   ${flag}  ${sub.name}`);
    }
    console.log('');

    // Step 3: Verify non-Repair subcategories are deactivated
    console.log('📝 Step 3: Checking non-Repair subcategories...');
    const nonRepairSubs = await client.query(`
      SELECT s.name, s.is_active, c.name AS category_name
      FROM workshop_task_subcategories s
      INNER JOIN workshop_task_categories c ON s.category_id = c.id
      WHERE NOT (c.slug = 'repair' AND c.applies_to = 'van')
      ORDER BY c.name, s.name
    `);
    if (nonRepairSubs.rows.length === 0) {
      console.log('   ℹ️  No non-Repair subcategories found\n');
    } else {
      for (const sub of nonRepairSubs.rows) {
        const flag = sub.is_active ? '⚠️  Still Active' : '✅ Deactivated';
        console.log(`   ${flag}  ${sub.category_name} → ${sub.name}`);
      }
      console.log('');
    }

    // Step 4: Verify no actions still reference deactivated subcategories
    console.log('📝 Step 4: Checking actions migration...');
    const orphanCheck = await client.query(`
      SELECT COUNT(*) AS remaining
      FROM actions a
      INNER JOIN workshop_task_subcategories s ON a.workshop_subcategory_id = s.id
      WHERE s.is_active = false
    `);
    const remaining = parseInt(orphanCheck.rows[0].remaining, 10);

    if (remaining > 0) {
      console.log(`   ⚠️  ${remaining} actions still reference deactivated subcategories`);
    } else {
      console.log('   ✅ No actions reference deactivated subcategories\n');
    }

    console.log('🎉 Migration complete!');
  } catch (err: unknown) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
