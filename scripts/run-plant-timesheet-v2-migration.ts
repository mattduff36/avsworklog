import { config } from 'dotenv';
import { resolve, join } from 'path';
import fs from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260328_plant_timesheet_v2_template.sql';

function getConnectionCandidates(): string[] {
  return Array.from(
    new Set(
      [process.env.POSTGRES_URL_NON_POOLING, process.env.POSTGRES_URL].filter(
        (value): value is string => Boolean(value)
      )
    )
  );
}

async function runMigrationWithConnection(connectionString: string) {
  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const sqlPath = join(process.cwd(), MIGRATION_FILE);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log(`Applying ${MIGRATION_FILE} via ${url.hostname}:${url.port || '5432'}...`);
    await client.query(sql);

    const { rows: timesheetColumns } = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'timesheets'
        AND column_name IN (
          'template_version',
          'site_address',
          'hirer_name',
          'is_hired_plant',
          'hired_plant_id_serial',
          'hired_plant_description',
          'hired_plant_hiring_company'
        )
      ORDER BY column_name
    `);

    const { rows: entryColumns } = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'timesheet_entries'
        AND column_name IN (
          'operator_travel_hours',
          'operator_yard_hours',
          'operator_working_hours',
          'machine_travel_hours',
          'machine_start_time',
          'machine_finish_time',
          'machine_working_hours',
          'machine_standing_hours',
          'machine_operator_hours',
          'maintenance_breakdown_hours'
        )
      ORDER BY column_name
    `);

    const { rows: sampleTimesheet } = await client.query<{
      id: string;
      timesheet_type: string | null;
      template_version: number;
      site_address: string | null;
      hirer_name: string | null;
      is_hired_plant: boolean | null;
      hired_plant_id_serial: string | null;
      hired_plant_description: string | null;
      hired_plant_hiring_company: string | null;
    }>(`
      SELECT
        id,
        timesheet_type,
        template_version,
        site_address,
        hirer_name,
        is_hired_plant,
        hired_plant_id_serial,
        hired_plant_description,
        hired_plant_hiring_company
      FROM timesheets
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (timesheetColumns.length !== 7) {
      throw new Error('Expected timesheets plant v2 header columns to exist after migration.');
    }

    if (entryColumns.length !== 10) {
      throw new Error('Expected plant timesheet entry columns to exist after migration.');
    }

    console.log('Plant timesheet v2 migration applied and verified.');
    console.log('timesheets columns:', timesheetColumns.map((row) => row.column_name));
    console.log('timesheet_entries columns:', entryColumns.map((row) => row.column_name));
    console.log('Latest timesheet sample:', sampleTimesheet[0] || null);
  } finally {
    await client.end();
  }
}

async function main() {
  const connectionCandidates = getConnectionCandidates();
  if (connectionCandidates.length === 0) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
  }

  let lastError: unknown;

  for (const connectionString of connectionCandidates) {
    try {
      await runMigrationWithConnection(connectionString);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('MaxClientsInSessionMode') ||
        connectionString === connectionCandidates[connectionCandidates.length - 1]
      ) {
        throw error;
      }
      console.warn('Primary session-mode connection is saturated, retrying with fallback connection...');
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
