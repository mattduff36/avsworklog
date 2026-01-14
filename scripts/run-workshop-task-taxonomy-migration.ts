/**
 * Migration Runner: Workshop Task Taxonomy (2-tier)
 * 
 * This script:
 * 1. Runs the SQL migration to create subcategories table and add columns
 * 2. Seeds top-level categories (Service, Repair, Modification, Other)
 * 3. Converts existing categories into subcategories
 * 4. Backfills existing tasks with new subcategory_id
 * 
 * Usage: npx tsx scripts/run-workshop-task-taxonomy-migration.ts
 */

import { config } from 'dotenv';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables
config({ path: '.env.local' });

const { Client } = pg;

interface CategoryMapping {
  oldId: string;
  oldName: string;
  newCategoryId: string;
  newCategoryName: string;
  newSubcategoryId: string;
  newSubcategoryName: string;
}

async function runMigration() {
  console.log('🚀 Starting Workshop Task Taxonomy Migration\n');

  // Parse connection string
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
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // ========================================
    // STEP 1: Run SQL migration
    // ========================================
    console.log('📝 Step 1: Running SQL migration...');
    const sqlPath = join(process.cwd(), 'supabase/migrations/20260114_workshop_task_taxonomy.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    await client.query(sql);
    console.log('   ✅ SQL migration complete\n');

    // ========================================
    // STEP 2: Get existing categories
    // ========================================
    console.log('📝 Step 2: Fetching existing categories...');
    const existingCategoriesResult = await client.query(`
      SELECT id, name, applies_to
      FROM workshop_task_categories
      ORDER BY sort_order, name
    `);
    const existingCategories = existingCategoriesResult.rows;
    console.log(`   Found ${existingCategories.length} existing categories\n`);

    // ========================================
    // STEP 3: Seed top-level categories
    // ========================================
    console.log('📝 Step 3: Seeding top-level categories...');
    
    const topLevelCategories = [
      { name: 'Service', slug: 'service', sort_order: 1, ui_color: 'blue', ui_badge_style: 'default' },
      { name: 'Repair', slug: 'repair', sort_order: 2, ui_color: 'orange', ui_badge_style: 'default' },
      { name: 'Modification', slug: 'modification', sort_order: 3, ui_color: 'purple', ui_badge_style: 'default' },
      { name: 'Other', slug: 'other', sort_order: 4, ui_color: 'gray', ui_badge_style: 'default' },
    ];

    const categoryIdMap: Record<string, string> = {};

    for (const category of topLevelCategories) {
      // Check if already exists
      const existingResult = await client.query(
        `SELECT id FROM workshop_task_categories WHERE slug = $1 AND applies_to = 'vehicle'`,
        [category.slug]
      );

      if (existingResult.rows.length > 0) {
        console.log(`   - ${category.name} already exists, skipping`);
        categoryIdMap[category.slug] = existingResult.rows[0].id;
      } else {
        const insertResult = await client.query(`
          INSERT INTO workshop_task_categories (name, slug, applies_to, sort_order, is_active, ui_color, ui_badge_style)
          VALUES ($1, $2, 'vehicle', $3, true, $4, $5)
          RETURNING id
        `, [category.name, category.slug, category.sort_order, category.ui_color, category.ui_badge_style]);

        categoryIdMap[category.slug] = insertResult.rows[0].id;
        console.log(`   ✅ Created category: ${category.name}`);
      }
    }
    console.log('');

    // ========================================
    // STEP 4: Convert existing categories to subcategories
    // ========================================
    console.log('📝 Step 4: Converting existing categories to subcategories...');

    const categoryMappings: CategoryMapping[] = [];

    // Define mapping rules
    const subcategoryMappingRules: Record<string, string> = {
      'Uncategorised': 'other',
      'Brakes': 'repair',
      'Engine': 'repair',
      'Electrical': 'repair',
      'Suspension & Steering': 'repair',
      'Bodywork': 'repair',
      'Transmission': 'repair',
      'Tyres': 'repair',
      'Exhaust': 'repair',
      'Lighting': 'repair',
      'Cooling': 'repair',
      'Fuel System': 'repair',
    };

    for (const oldCategory of existingCategories) {
      // Skip if this is one of our new top-level categories
      if (['Service', 'Repair', 'Modification', 'Other'].includes(oldCategory.name)) {
        console.log(`   - Skipping ${oldCategory.name} (is a top-level category)`);
        continue;
      }

      // Determine parent category
      const parentSlug = subcategoryMappingRules[oldCategory.name] || 'other';
      const parentCategoryId = categoryIdMap[parentSlug];

      if (!parentCategoryId) {
        console.warn(`   ⚠️ Warning: No parent category found for ${oldCategory.name}, defaulting to Other`);
        continue;
      }

      // Create subcategory with same name
      const slug = oldCategory.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      // Check if subcategory already exists
      const existingSubcatResult = await client.query(
        `SELECT id FROM workshop_task_subcategories WHERE category_id = $1 AND slug = $2`,
        [parentCategoryId, slug]
      );

      let subcategoryId: string;

      if (existingSubcatResult.rows.length > 0) {
        subcategoryId = existingSubcatResult.rows[0].id;
        console.log(`   - Subcategory ${oldCategory.name} already exists under ${parentSlug}`);
      } else {
        const insertResult = await client.query(`
          INSERT INTO workshop_task_subcategories (
            category_id, 
            name, 
            slug, 
            sort_order, 
            is_active,
            created_at
          )
          VALUES ($1, $2, $3, 0, true, NOW())
          RETURNING id
        `, [parentCategoryId, oldCategory.name, slug]);

        subcategoryId = insertResult.rows[0].id;
        console.log(`   ✅ Created subcategory: ${oldCategory.name} under ${parentSlug}`);
      }

      // Store mapping for backfill
      categoryMappings.push({
        oldId: oldCategory.id,
        oldName: oldCategory.name,
        newCategoryId: parentCategoryId,
        newCategoryName: parentSlug,
        newSubcategoryId: subcategoryId,
        newSubcategoryName: oldCategory.name,
      });
    }
    console.log('');

    // ========================================
    // STEP 5: Backfill existing tasks
    // ========================================
    console.log('📝 Step 5: Backfilling existing workshop tasks...');

    for (const mapping of categoryMappings) {
      const updateResult = await client.query(`
        UPDATE actions
        SET 
          workshop_subcategory_id = $1,
          workshop_category_id = $2
        WHERE workshop_category_id = $3
          AND action_type IN ('inspection_defect', 'workshop_vehicle_task')
        RETURNING id
      `, [mapping.newSubcategoryId, mapping.newCategoryId, mapping.oldId]);

      const count = updateResult.rowCount || 0;
      if (count > 0) {
        console.log(`   ✅ Updated ${count} tasks: ${mapping.oldName} → ${mapping.newCategoryName}/${mapping.newSubcategoryName}`);
      }
    }
    console.log('');

    // ========================================
    // STEP 6: Archive old category rows (optional)
    // ========================================
    console.log('📝 Step 6: Archiving old category rows...');
    
    // Mark old categories as inactive (but don't delete them for safety)
    for (const mapping of categoryMappings) {
      await client.query(`
        UPDATE workshop_task_categories
        SET is_active = false
        WHERE id = $1
      `, [mapping.oldId]);
    }
    console.log('   ✅ Old categories marked as inactive\n');

    // ========================================
    // STEP 7: Create "Other" subcategories for each top-level category
    // ========================================
    console.log('📝 Step 7: Creating "Other" subcategories...');

    for (const [slug, categoryId] of Object.entries(categoryIdMap)) {
      // Check if "Other" subcategory exists
      const existingOtherResult = await client.query(
        `SELECT id FROM workshop_task_subcategories WHERE category_id = $1 AND slug = 'other'`,
        [categoryId]
      );

      if (existingOtherResult.rows.length === 0) {
        await client.query(`
          INSERT INTO workshop_task_subcategories (
            category_id, 
            name, 
            slug, 
            sort_order, 
            is_active,
            created_at
          )
          VALUES ($1, 'Other', 'other', 9999, true, NOW())
        `, [categoryId]);
        console.log(`   ✅ Created "Other" subcategory under ${slug}`);
      }
    }
    console.log('');

    // ========================================
    // STEP 8: Summary
    // ========================================
    console.log('📊 Migration Summary:');
    console.log(`   - Top-level categories: ${Object.keys(categoryIdMap).length}`);
    console.log(`   - Subcategories created: ${categoryMappings.length}`);
    
    const tasksWithSubcategoryResult = await client.query(`
      SELECT COUNT(*) as count
      FROM actions
      WHERE workshop_subcategory_id IS NOT NULL
    `);
    console.log(`   - Tasks with subcategory: ${tasksWithSubcategoryResult.rows[0].count}`);
    console.log('');

    console.log('✅ Migration completed successfully!\n');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run migration
runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
