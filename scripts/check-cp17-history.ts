/**
 * Check CP17 TKO maintenance history
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

async function checkHistory() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // Get vehicle ID
    const { rows: vehicles } = await client.query(`
      SELECT id, reg_number FROM vehicles WHERE reg_number = 'CP17 TKO'
    `);

    if (vehicles.length === 0) {
      console.log('Vehicle not found');
      return;
    }

    const vehicleId = vehicles[0].id;
    console.log(`Vehicle: ${vehicles[0].reg_number} (ID: ${vehicleId})\n`);

    // Get ALL history entries
    const { rows: history } = await client.query(`
      SELECT *
      FROM maintenance_history
      WHERE vehicle_id = $1
      ORDER BY created_at DESC
    `, [vehicleId]);

    console.log(`Total history entries: ${history.length}\n`);

    history.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.field_name}`);
      console.log(`   Old: ${entry.old_value}`);
      console.log(`   New: ${entry.new_value}`);
      console.log(`   User: ${entry.updated_by_name || 'Unknown'}`);
      console.log(`   Date: ${new Date(entry.created_at).toLocaleString()}`);
      console.log(`   Comment: ${entry.comment}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

checkHistory();
