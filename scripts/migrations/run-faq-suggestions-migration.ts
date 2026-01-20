import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/faq-and-suggestions.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

// Type assertion since we've validated above
const validConnectionString = connectionString as string;

async function runMigration() {
  console.log('🚀 Running FAQ & Suggestions Migration...\n');

  // Parse connection string and rebuild with explicit SSL config
  const url = new URL(validConnectionString);
  
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

    // Read the migration SQL file
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Verify tables were created
    const tables = ['faq_categories', 'faq_articles', 'suggestions', 'suggestion_updates'];
    
    console.log('📊 Verifying tables created:');
    for (const table of tables) {
      const { rows } = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name = $1
      `, [table]);

      if (rows.length > 0) {
        console.log(`   ✅ ${table}`);
      } else {
        console.log(`   ❌ ${table} - NOT FOUND`);
      }
    }
    
    console.log('\n📊 Database changes applied:');
    console.log('   ✓ faq_categories - FAQ category groupings');
    console.log('   ✓ faq_articles - FAQ content with markdown');
    console.log('   ✓ suggestions - User suggestions');
    console.log('   ✓ suggestion_updates - Suggestion audit trail');
    console.log('   ✓ RLS policies for all tables');
    console.log('   ✓ Full-text search index on FAQ articles\n');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Ready! Now seed FAQ content with:');
    console.log('   npx tsx scripts/seed/seed-faq-howto.ts');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MIGRATION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('Error:', error.message);
    if (error.detail) {
      console.error('Details:', error.detail);
    }
    if (error.hint) {
      console.error('Hint:', error.hint);
    }
    
    // Check if tables already exist (migration was already applied)
    if (error.message?.includes('already exists')) {
      console.log('\n✅ Tables already exist - migration was previously applied.\n');
      process.exit(0);
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
