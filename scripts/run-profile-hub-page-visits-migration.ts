import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260329_profile_hub_and_page_visits.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Set POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL in .env.local');
  process.exit(1);
}

async function runMigration() {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Running profile hub migration...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const [avatarColumnResult, pageVisitsTableResult, avatarBucketResult] = await Promise.all([
      client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'avatar_url'
      `),
      client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_page_visits'
      `),
      client.query(`
        SELECT id
        FROM storage.buckets
        WHERE id = 'user-avatars'
      `),
    ]);

    console.log('Migration complete');
    console.log(`profiles.avatar_url: ${avatarColumnResult.rows.length > 0 ? 'OK' : 'MISSING'}`);
    console.log(`public.user_page_visits: ${pageVisitsTableResult.rows.length > 0 ? 'OK' : 'MISSING'}`);
    console.log(`storage.user-avatars bucket: ${avatarBucketResult.rows.length > 0 ? 'OK' : 'MISSING'}`);
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();

