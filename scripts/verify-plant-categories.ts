import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

async function verifyMigration() {
  const url = new URL(connectionString!);
  
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
    
    console.log('🔍 Verifying Plant Maintenance Categories...\n');
    
    // Query for plant categories
    const result = await client.query(`
      SELECT 
        name,
        type,
        alert_threshold_days,
        alert_threshold_miles,
        alert_threshold_hours,
        applies_to,
        responsibility,
        is_active
      FROM maintenance_categories
      WHERE 'plant' = ANY(applies_to)
      ORDER BY sort_order;
    `);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 PLANT MAINTENANCE CATEGORIES');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    if (result.rows.length === 0) {
      console.log('❌ No plant categories found!');
    } else {
      result.rows.forEach((row, index) => {
        console.log(`${index + 1}. ${row.name}`);
        console.log(`   Type: ${row.type}`);
        console.log(`   Threshold: ${
          row.type === 'hours' ? `${row.alert_threshold_hours} hours` :
          row.type === 'date' ? `${row.alert_threshold_days} days` :
          `${row.alert_threshold_miles} miles`
        }`);
        console.log(`   Responsibility: ${row.responsibility}`);
        console.log(`   Applies to: ${row.applies_to.join(', ')}`);
        console.log(`   Active: ${row.is_active ? '✅ Yes' : '❌ No'}`);
        console.log('');
      });
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Found ${result.rows.length} plant maintenance categories`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error: any) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verifyMigration().catch(console.error);
