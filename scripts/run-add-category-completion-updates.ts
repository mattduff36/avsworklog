import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260116_add_category_completion_updates.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error(
    'Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local'
  );
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Category Completion Updates Migration...\n');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('✅ MIGRATION COMPLETED!\n');

    // Verify column exists
    const { rows: columnCheck } = await client.query(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_name = 'workshop_task_categories' AND column_name = 'completion_updates'
    `);

    if (columnCheck.length > 0) {
      console.log('✅ completion_updates column verified');
      console.log(`   Default: ${columnCheck[0].column_default}\n`);
    }

    // Check Service category config
    const { rows: serviceCategories } = await client.query(`
      SELECT id, name, completion_updates
      FROM workshop_task_categories
      WHERE name ILIKE '%service%' AND applies_to = 'van'
    `);

    if (serviceCategories.length > 0) {
      console.log('📦 Service category configuration:');
      serviceCategories.forEach((cat) => {
        console.log(`   - ${cat.name} (${cat.id})`);
        console.log(`     Updates: ${JSON.stringify(cat.completion_updates, null, 2)}`);
      });
    } else {
      console.log('⚠️  No Service category found - you may need to configure manually');
    }
  } catch (err: unknown) {
    console.error('❌ MIGRATION FAILED:', (err instanceof Error ? err.message : String(err)));

    if ((err instanceof Error ? err.message : String(err))?.includes('already exists')) {
      console.log('✅ Already applied - no action needed!');
      process.exit(0);
    }

    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
