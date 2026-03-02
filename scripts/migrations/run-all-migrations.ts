import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

// List of migrations to run in order
const migrations = [
  {
    file: 'supabase/add-mileage-column.sql',
    description: 'Add current_mileage column to vehicle_inspections'
  },
  {
    file: 'supabase/add-inspection-date-range.sql',
    description: 'Add date range support to vehicle_inspections'
  },
  {
    file: 'supabase/add-inspection-signature.sql',
    description: 'Add signature fields to vehicle_inspections'
  },
  {
    file: 'supabase/create-actions-table.sql',
    description: 'Create actions table for manager defect tracking'
  }
];

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigrations() {
  console.log('🚀 Running database migrations...\n');
  console.log(`📋 ${migrations.length} migrations to run\n`);

  // Parse connection string and rebuild with explicit SSL config
  const url = new URL(connectionString as string);
  
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
    console.log('📡 Connecting to Supabase database...');
    await client.connect();
    console.log('✅ Connected!\n');

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (let i = 0; i < migrations.length; i++) {
      const migration = migrations[i];
      const num = i + 1;

      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📦 Migration ${num}/${migrations.length}: ${migration.description}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      try {
        // Read the migration SQL file
        const migrationSQL = readFileSync(
          resolve(process.cwd(), migration.file),
          'utf-8'
        );

        console.log('📄 Executing SQL...');
        
        // Execute the migration
        await client.query(migrationSQL);
        
        console.log('✅ Success!\n');
        successCount++;
      } catch (err: unknown) {
        const pgErr = err as { message: string; detail?: string; code?: string };
        if (pgErr.message?.includes('already exists') || pgErr.code === '42P07' || pgErr.code === '42701') {
          console.log('⏭️  Already applied - skipping\n');
          skipCount++;
        } else {
          console.error('❌ Failed!');
          console.error('Error:', pgErr.message);
          if (pgErr.detail) {
            console.error('Details:', pgErr.detail);
          }
          console.log();
          failCount++;
        }
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 MIGRATION SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Successful: ${successCount}`);
    console.log(`⏭️  Skipped: ${skipCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (failCount > 0) {
      console.log('⚠️  Some migrations failed. Please review the errors above.');
      process.exit(1);
    } else {
      console.log('🎉 All migrations completed successfully!');
      console.log('\n✨ Ready to use! Restart your dev server:');
      console.log('   npm run dev\n');
    }

  } catch (err: unknown) {
    const pgErr = err as { message: string };
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ CONNECTION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('Error:', pgErr.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations().catch(console.error);

