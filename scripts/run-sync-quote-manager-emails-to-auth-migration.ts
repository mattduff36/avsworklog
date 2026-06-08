import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260608_sync_quote_manager_emails_to_auth.sql';

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
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Running quote manager email auth sync migration...');
    await client.connect();

    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);

    const verification = await client.query<{
      manager_name: string | null;
      initials: string;
      manager_email: string | null;
      auth_email: string | null;
      email_matches_auth: boolean;
    }>(`
      SELECT
        p.full_name AS manager_name,
        qms.initials,
        qms.manager_email,
        au.email AS auth_email,
        qms.manager_email IS NOT DISTINCT FROM au.email AS email_matches_auth
      FROM public.quote_manager_series qms
      LEFT JOIN public.profiles p ON p.id = qms.profile_id
      LEFT JOIN auth.users au ON au.id = qms.profile_id
      ORDER BY qms.initials
    `);

    const staleLouisEmail = await client.query<{ stale_count: string }>(`
      SELECT (
        SELECT count(*) FROM public.quote_manager_series WHERE lower(manager_email) = 'louis@avsquires.co.uk'
      ) + (
        SELECT count(*) FROM public.quotes WHERE lower(manager_email) = 'louis@avsquires.co.uk'
      ) AS stale_count
    `);

    const staleCount = Number(staleLouisEmail.rows[0]?.stale_count || 0);
    if (staleCount !== 0) {
      throw new Error(`Louis old email is still present in ${staleCount} quote record(s)`);
    }

    console.log('Migration complete');
    console.table(verification.rows);
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration();
