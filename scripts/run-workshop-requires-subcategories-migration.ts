/**
 * Migration Runner: Workshop requires_subcategories toggle
 *
 * Adds `requires_subcategories` boolean column to workshop_task_categories,
 * enables it only for "Repair (Vehicle)", and clears orphaned subcategory
 * references on actions whose category no longer requires subcategories.
 *
 * Usage: npx tsx scripts/run-workshop-requires-subcategories-migration.ts
 */

import { config } from 'dotenv';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

config({ path: '.env.local' });

const { Client } = pg;

async function runMigration() {
  console.log('🚀 Starting requires_subcategories migration\n');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not found in environment');
  }

  const url = new URL(connectionString);

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
      'supabase/migrations/20260217_workshop_requires_subcategories.sql'
    );
    const sql = readFileSync(sqlPath, 'utf-8');
    await client.query(sql);
    console.log('   ✅ SQL migration complete\n');

    // Step 2: Verify column was added
    console.log('📝 Step 2: Verifying column...');
    const colCheck = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'workshop_task_categories'
        AND column_name = 'requires_subcategories'
    `);

    if (colCheck.rows.length === 0) {
      throw new Error('Column requires_subcategories was not created');
    }
    console.log('   ✅ Column exists:', colCheck.rows[0], '\n');

    // Step 3: Verify Repair category is enabled
    console.log('📝 Step 3: Checking category states...');
    const categories = await client.query(`
      SELECT name, slug, applies_to, requires_subcategories
      FROM workshop_task_categories
      WHERE is_active = true
      ORDER BY sort_order, name
    `);

    for (const cat of categories.rows) {
      const flag = cat.requires_subcategories ? '✅ ON' : '⬜ OFF';
      console.log(`   ${flag}  ${cat.name} (${cat.applies_to})`);
    }
    console.log('');

    // Step 4: Report migrated actions
    console.log('📝 Step 4: Checking actions migration...');
    const orphanCheck = await client.query(`
      SELECT COUNT(*) AS remaining
      FROM actions a
      INNER JOIN workshop_task_subcategories s ON a.workshop_subcategory_id = s.id
      INNER JOIN workshop_task_categories c ON s.category_id = c.id
      WHERE c.requires_subcategories = false
    `);
    const remaining = parseInt(orphanCheck.rows[0].remaining, 10);

    if (remaining > 0) {
      console.log(`   ⚠️  ${remaining} actions still reference subcategories on non-subcategory categories`);
    } else {
      console.log('   ✅ No orphaned subcategory references\n');
    }

    console.log('🎉 Migration complete!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
