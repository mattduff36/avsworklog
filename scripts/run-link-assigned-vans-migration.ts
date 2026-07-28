import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260728163414_link_assigned_vans_to_users.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

interface VerificationRow {
  linked_count: number;
  archived_link_count: number;
  pool_link_count: number;
}

async function runMigration() {
  console.log('Running assigned van linking migration...');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows } = await client.query<VerificationRow>(`
      SELECT
        COUNT(*) FILTER (
          WHERE assignment.ended_at IS NULL
            AND van.status = 'active'
            AND BTRIM(van.reg_number) NOT IN ('FH13 XPT', 'GP07 NBZ')
            AND LOWER(BTRIM(van.nickname)) = LOWER(BTRIM(profile.full_name))
        )::INTEGER AS linked_count,
        COUNT(*) FILTER (
          WHERE assignment.ended_at IS NULL
            AND van.status = 'archived'
        )::INTEGER AS archived_link_count,
        COUNT(*) FILTER (
          WHERE assignment.ended_at IS NULL
            AND BTRIM(van.reg_number) IN ('FH13 XPT', 'GP07 NBZ')
        )::INTEGER AS pool_link_count
      FROM public.profile_fleet_assignments assignment
      JOIN public.vans van
        ON van.id = assignment.linked_van_id
      JOIN public.profiles profile
        ON profile.id = assignment.user_id
    `);

    const verification = rows[0];
    if (!verification) {
      throw new Error('Assignment verification returned no result');
    }
    if (verification.linked_count !== 47) {
      throw new Error(`Expected 47 linked assigned vans, found ${verification.linked_count}`);
    }
    if (verification.archived_link_count !== 0) {
      throw new Error(`Found ${verification.archived_link_count} archived vans with current links`);
    }
    if (verification.pool_link_count !== 0) {
      throw new Error(`Found ${verification.pool_link_count} confirmed pool vans with current links`);
    }

    console.log('Assigned van linking migration completed.');
    console.log('Verified 47 current links; archived and confirmed pool vans remain unlinked.');
  } catch (error) {
    console.error(
      'Assigned van linking migration failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
