import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const TARGET_PROJECT_REF = 'lrhufzqfzeutgvudcowy';
const SQL_FILE = 'supabase/migrations/20260717_debug_disable_sensitive_pin.sql';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

if (!connectionString.includes(TARGET_PROJECT_REF)) {
  console.error('Database connection string does not target the approved Supabase project.');
  console.error(`Expected project ref: ${TARGET_PROJECT_REF}`);
  process.exit(1);
}

function createClient() {
  const url = new URL(connectionString!);

  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function runMigration() {
  const client = createClient();

  try {
    console.log('Disabling sensitive PIN requirement for debug module...');
    await client.connect();

    const migrationSql = readFileSync(resolve(process.cwd(), SQL_FILE), 'utf-8');
    await client.query(migrationSql);

    const { rows } = await client.query<{ requires_sensitive_pin: boolean }>(`
      SELECT requires_sensitive_pin
      FROM public.permission_modules
      WHERE module_name = 'debug'
    `);

    if (rows.length !== 1) {
      throw new Error('Debug permission module row was not found.');
    }

    if (rows[0].requires_sensitive_pin !== false) {
      throw new Error('Debug module still requires a sensitive PIN after migration.');
    }

    console.log('Debug sensitive PIN requirement disabled successfully.');
  } catch (error) {
    console.error('Debug disable-sensitive-pin migration failed:');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
