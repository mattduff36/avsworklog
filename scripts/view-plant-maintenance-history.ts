#!/usr/bin/env tsx

/**
 * View Plant Maintenance History
 * 
 * Shows all remaining maintenance history entries for plant records.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import pg from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const { Client } = pg;

async function viewPlantMaintenanceHistory() {
  console.log('📋 Viewing Plant Maintenance History...\n');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING environment variable is not set');
  }

  const config = parseConnectionString(connectionString);
  
  const client = new Client({
    host: config.host!,
    port: parseInt(config.port || '5432', 10),
    database: config.database!,
    user: config.user!,
    password: config.password!,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const query = `
      SELECT 
        mh.id,
        p.plant_id,
        mh.field_name,
        mh.old_value,
        mh.new_value,
        mh.value_type,
        mh.comment,
        mh.created_at,
        mh.updated_by_name
      FROM maintenance_history mh
      JOIN plant p ON p.id = mh.plant_id
      WHERE mh.plant_id IS NOT NULL
      ORDER BY mh.created_at DESC
    `;

    const result = await client.query(query);
    
    console.log(`Found ${result.rows.length} plant maintenance history entries:\n`);

    result.rows.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.plant_id} - ${entry.field_name}`);
      console.log(`   Old Value: ${entry.old_value || 'null'} → New Value: ${entry.new_value || 'null'}`);
      console.log(`   Comment: "${entry.comment}"`);
      console.log(`   Created: ${new Date(entry.created_at).toLocaleString()}`);
      console.log(`   By: ${entry.updated_by_name}`);
      console.log('');
    });

  } catch (error) {
    console.error('\n❌ Error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

viewPlantMaintenanceHistory()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
