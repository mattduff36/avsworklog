import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function checkErrorLogs() {
  const dbUrl = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!dbUrl) {
    console.error('POSTGRES_URL_NON_POOLING not found in environment');
    process.exit(1);
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to database\n');

    // Query error logs from December 8th, 2025 at 11am onwards
    const result = await client.query(`
      SELECT 
        id, 
        timestamp, 
        error_type, 
        error_message, 
        error_stack,
        component_name,
        page_url,
        user_id,
        user_email,
        user_agent,
        additional_data
      FROM error_logs
      WHERE timestamp >= '2025-12-08 11:00:00'
      ORDER BY timestamp DESC
    `);

    console.log(`Found ${result.rows.length} error(s) from 08/12/2025 11:00 onwards:\n`);
    console.log(JSON.stringify(result.rows, null, 2));

    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkErrorLogs();
