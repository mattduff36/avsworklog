import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

interface PlantAssetJSON {
  AssetNumber: number;
  Description: string;
  Registration: string;
  SerialNumber: string;
  Year: number | string | null;
  MainCategory: string;
  SubCategory: string;
  WeightClass: string | null;
}

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function seedPlantAssets() {
  const jsonPath = resolve(process.cwd(), 'seed/plant_assets_with_categories_weightclass.json');
  const jsonData: PlantAssetJSON[] = JSON.parse(readFileSync(jsonPath, 'utf-8'));

  console.log(`📦 Loaded ${jsonData.length} plant assets from JSON\n`);

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
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const categories = [...new Set(jsonData.map(asset => asset.MainCategory))];
    const categoryMap = new Map<string, string>();

    for (const categoryName of categories) {
      const existing = await client.query(
        'SELECT id FROM vehicle_categories WHERE name = $1',
        [categoryName]
      );

      if (existing.rows.length > 0) {
        categoryMap.set(categoryName, existing.rows[0].id);
      } else {
        const result = await client.query(
          'INSERT INTO vehicle_categories (name, description) VALUES ($1, $2) RETURNING id',
          [categoryName, `Plant machinery category: ${categoryName}`]
        );
        categoryMap.set(categoryName, result.rows[0].id);
        console.log(`   ✅ Created category: ${categoryName}`);
      }
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const asset of jsonData) {
      const plantId = String(asset.AssetNumber);
      const regNumber = asset.Registration?.trim() || null;
      const serialNumber = asset.SerialNumber?.trim() || null;
      const weightClass = asset.WeightClass || null;
      const nickname = asset.Description || null;
      const vehicleType = asset.SubCategory || null;
      const categoryId = categoryMap.get(asset.MainCategory);

      const yearValue = typeof asset.Year === 'number'
        ? asset.Year
        : (typeof asset.Year === 'string' && asset.Year.trim()
          ? parseInt(asset.Year, 10)
          : null);

      if (!categoryId) {
        console.warn(`⚠️  Skipped ${plantId}: category not found`);
        skipped++;
        continue;
      }

      const existing = await client.query(
        'SELECT id FROM vehicles WHERE plant_id = $1',
        [plantId]
      );

      if (existing.rows.length > 0) {
        await client.query(`
          UPDATE vehicles SET
            asset_type = 'plant',
            reg_number = COALESCE($2, reg_number),
            serial_number = COALESCE($3, serial_number),
            year = COALESCE($4, year),
            weight_class = COALESCE($5, weight_class),
            nickname = COALESCE($6, nickname),
            vehicle_type = COALESCE($7, vehicle_type),
            category_id = $8
          WHERE plant_id = $1
        `, [plantId, regNumber, serialNumber, yearValue, weightClass, nickname, vehicleType, categoryId]);
        updated++;
      } else {
        await client.query(`
          INSERT INTO vehicles (
            asset_type,
            plant_id,
            reg_number,
            serial_number,
            year,
            weight_class,
            nickname,
            vehicle_type,
            category_id,
            status
          ) VALUES (
            'plant',
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            'active'
          )
        `, [plantId, regNumber, serialNumber, yearValue, weightClass, nickname, vehicleType, categoryId]);
        inserted++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   ✅ Inserted: ${inserted}`);
    console.log(`   🔄 Updated: ${updated}`);
    console.log(`   ⚠️  Skipped: ${skipped}`);
    console.log(`   📦 Total processed: ${jsonData.length}`);
  } catch (error) {
    console.error('\n❌ Seed failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n👋 Database connection closed');
  }
}

seedPlantAssets().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
