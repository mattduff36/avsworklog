import { Client } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function deleteExistingActions() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in environment');
    process.exit(1);
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
    console.log('🔌 Connecting to database...\n');
    await client.connect();

    // Delete all existing actions
    console.log('🗑️  Deleting all existing actions...\n');
    
    const deleteResult = await client.query('DELETE FROM actions RETURNING id');
    
    console.log(`✅ Deleted ${deleteResult.rowCount} actions\n`);

  } catch (error) {
    console.error('❌ Delete failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

deleteExistingActions();
