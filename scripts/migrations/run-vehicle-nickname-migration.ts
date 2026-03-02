// @ts-nocheck
/**
 * Add nickname column to vehicles table and backfill data
 * 
 * This migration:
 * 1. Adds nickname column to vehicles table
 * 2. Backfills from last_inspector where available
 * 3. Sets 'ChangeMe' for vehicles without inspector data
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

async function runMigration() {
  console.log('🚀 Starting vehicle nickname migration...\n');

  // Read database URL from environment
  const databaseUrl = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!databaseUrl) {
    throw new Error('❌ POSTGRES_URL_NON_POOLING environment variable is not set');
  }

  // Parse the connection URL
  const url = new URL(databaseUrl);
  
  // Create client with SSL configuration
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    // Connect to database
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database\n');

    // Read migration SQL file
    const migrationPath = resolve(process.cwd(), 'supabase/migrations/20251218_add_vehicle_nickname.sql');
    console.log(`📄 Reading migration file: ${migrationPath}\n`);
    const sql = readFileSync(migrationPath, 'utf-8');

    // Execute migration
    console.log('⚙️  Executing migration...\n');
    const result = await client.query(sql);

    // Log results
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Show the verification results (last query result)
    if (Array.isArray(result)) {
      const verificationResult = result[result.length - 2]; // Second to last is the count query
      if (verificationResult?.rows?.[0]) {
        const stats = verificationResult.rows[0];
        console.log('📊 Migration Statistics:');
        console.log(`   Total vehicles: ${stats.total_vehicles}`);
        console.log(`   Named vehicles: ${stats.named_count}`);
        console.log(`   'ChangeMe' placeholders: ${stats.changeme_count}\n`);
      }
    }

    console.log('✅ Nickname column added to vehicles table');
    console.log('✅ Data backfilled from last_inspector');
    console.log('✅ Placeholders set for vehicles without data\n');

  } catch (error) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MIGRATION FAILED!');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('Error details:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed\n');
  }
}

// Run the migration
runMigration();
