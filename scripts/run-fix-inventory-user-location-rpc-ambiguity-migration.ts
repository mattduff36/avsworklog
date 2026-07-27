import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile =
  'supabase/migrations/20260727133500_fix_inventory_user_location_rpc_ambiguity.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running inventory user location RPC ambiguity fix migration...');

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

    const { rows: functionRows } = await client.query<{ definition: string }>(`
      SELECT pg_get_functiondef(
        'public.inventory_set_user_location_with_assignment(uuid,uuid,text,uuid)'::regprocedure
      ) AS definition
    `);
    const functionDefinition = functionRows[0]?.definition || '';
    if (
      !functionDefinition.includes(
        'ON CONFLICT ON CONSTRAINT inventory_user_locations_pkey DO UPDATE',
      )
    ) {
      throw new Error('Updated inventory user location RPC definition was not found');
    }

    const { rows: assignmentRows } = await client.query<{
      user_id: string;
      location_id: string;
    }>(`
      SELECT user_location.user_id, user_location.location_id
      FROM public.inventory_user_locations AS user_location
      JOIN public.inventory_locations AS location
        ON location.id = user_location.location_id
      WHERE location.is_active = TRUE
      ORDER BY user_location.updated_at DESC
      LIMIT 1
    `);
    const assignment = assignmentRows[0];
    if (!assignment) {
      throw new Error('No active user location assignment was available for RPC verification');
    }

    await client.query('BEGIN');
    try {
      const { rows: verificationRows } = await client.query<{
        user_id: string;
        location_id: string;
      }>(
        `
          SELECT user_id, location_id
          FROM public.inventory_set_user_location_with_assignment($1, $2, $3, $1)
        `,
        [assignment.user_id, assignment.location_id, 'Migration verification'],
      );

      if (
        verificationRows[0]?.user_id !== assignment.user_id
        || verificationRows[0]?.location_id !== assignment.location_id
      ) {
        throw new Error('Inventory user location RPC verification returned unexpected data');
      }
    } finally {
      await client.query('ROLLBACK');
    }

    console.log('Inventory user location RPC ambiguity fix completed and verified.');
  } catch (error) {
    console.error(
      'Inventory user location RPC ambiguity fix failed:',
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
