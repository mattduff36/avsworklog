import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

// Load environment variables
config({ path: '.env.local' });

async function runMigration() {
  console.log('🔧 Fixing profile creation trigger for RBAC...\n');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  
  if (!connectionString) {
    console.error('❌ Missing database connection string');
    console.error('Please ensure POSTGRES_URL_NON_POOLING is set in .env.local');
    process.exit(1);
  }

  // Parse connection string and rebuild with explicit SSL config
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

    // Read and execute the SQL file
    const sql = readFileSync(
      join(process.cwd(), 'supabase', 'fix-profile-trigger.sql'),
      'utf-8'
    );

    console.log('📝 Executing migration...\n');
    const result = await client.query(sql);

    // The last result should have our summary
    const lastResult = Array.isArray(result) ? result[result.length - 1] : result;
    
    if (lastResult.rows && lastResult.rows.length > 0) {
      console.log('✅ Migration completed successfully!\n');
      console.log('📊 Summary:');
      console.log(`   Users with role_id: ${lastResult.rows[0].users_with_role_id}`);
      console.log(`   Users missing role_id: ${lastResult.rows[0].users_missing_role_id}`);
      
      if (lastResult.rows[0].users_missing_role_id > 0) {
        console.log('\n⚠️  WARNING: Some users are missing role_id!');
        console.log('   You may need to manually assign roles to these users.');
      }
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

runMigration().catch(console.error);

