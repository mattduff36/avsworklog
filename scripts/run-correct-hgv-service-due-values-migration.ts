/**
 * Correct HGV Service due KM values + set service_hgv display_name = Service Due.
 *
 * Usage: npx tsx scripts/run-correct-hgv-service-due-values-migration.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260808_correct_hgv_service_due_values.sql';
const TARGET_PROJECT_REF = 'lrhufzqfzeutgvudcowy';

const EXPECTED: Array<{ reg: string; due: number }> = [
  { reg: 'AS71 AVS', due: 300402 },
  { reg: 'DS71 AVS', due: 306993 },
  { reg: 'ES71 AVS', due: 302137 },
  { reg: 'KS21 AVS', due: 420000 },
  { reg: 'KS71 AVS', due: 90000 },
  { reg: 'PS71 AVS', due: 341633 },
  { reg: 'SS15 AVS', due: 650000 },
  { reg: 'TS71 AVS', due: 260000 },
  { reg: 'VS71 AVS', due: 325906 },
  { reg: 'XT71 AVS', due: 170000 },
];

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING');
  process.exit(1);
}

function normalizeReg(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function createClient(): pg.Client {
  const url = new URL(connectionString!);
  // Pooler hosts omit the project ref; username is typically postgres.<project-ref>.
  if (
    !connectionString!.includes(TARGET_PROJECT_REF) &&
    !url.hostname.includes('localhost')
  ) {
    throw new Error(
      `Refusing migration: connection string does not include expected project ref ${TARGET_PROJECT_REF}`,
    );
  }
  return new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });
}

async function verify(client: pg.Client) {
  const { rows } = await client.query<{
    reg_number: string;
    next_service_mileage: number | null;
    due_mileage: number | null;
  }>(`
    SELECT h.reg_number, vm.next_service_mileage, cv.due_mileage
    FROM public.hgvs h
    JOIN public.vehicle_maintenance vm ON vm.hgv_id = h.id
    JOIN public.asset_maintenance_category_values cv ON cv.hgv_id = h.id
    JOIN public.maintenance_categories mc ON mc.id = cv.maintenance_category_id
    WHERE mc.config_key = 'service_hgv'
      AND UPPER(regexp_replace(h.reg_number, '[^A-Z0-9]', '', 'g')) = ANY($1::text[])
    ORDER BY h.reg_number
  `, [EXPECTED.map((row) => normalizeReg(row.reg))]);

  if (rows.length !== 10) {
    throw new Error(`Verification failed: expected 10 rows, found ${rows.length}`);
  }

  for (const expected of EXPECTED) {
    const live = rows.find((row) => normalizeReg(row.reg_number) === normalizeReg(expected.reg));
    if (!live) {
      throw new Error(`Missing ${expected.reg}`);
    }
    if (live.next_service_mileage !== expected.due || live.due_mileage !== expected.due) {
      throw new Error(
        `${expected.reg}: expected ${expected.due}, got vm=${live.next_service_mileage} cv=${live.due_mileage}`,
      );
    }
    console.log(`  ✓ ${expected.reg}: ${expected.due}`);
  }

  const { rows: labelRows } = await client.query<{ name: string; display_name: string | null; config_key: string }>(`
    SELECT name, display_name, config_key
    FROM public.maintenance_categories
    WHERE config_key = 'service_hgv'
  `);
  if (
    labelRows.length !== 1 ||
    labelRows[0].name !== 'Service' ||
    labelRows[0].display_name !== 'Service Due'
  ) {
    throw new Error(`service_hgv label post-condition failed: ${JSON.stringify(labelRows)}`);
  }
  console.log('  ✓ service_hgv display_name = Service Due (internal name remains Service)');

  const { rows: untouched } = await client.query<{ reg_number: string; next_service_mileage: number | null }>(`
    SELECT h.reg_number, vm.next_service_mileage
    FROM public.hgvs h
    JOIN public.vehicle_maintenance vm ON vm.hgv_id = h.id
    WHERE UPPER(regexp_replace(h.reg_number, '[^A-Z0-9]', '', 'g')) IN ('C517773', 'FL21TVE', 'TE57HGV')
       OR LOWER(COALESCE(h.nickname, '')) = 'test-hgv'
  `);
  for (const row of untouched) {
    if (row.next_service_mileage != null) {
      throw new Error(`${row.reg_number} must remain Not Set / untouched`);
    }
  }
  console.log('  ✓ Not Set + TEST-HGV untouched');
}

async function run() {
  console.log('Running HGV service due correction migration...\n');
  const client = createClient();

  try {
    await client.connect();
    await client.query('BEGIN');
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf8');
    await client.query(sql);
    await verify(client);
    await client.query('COMMIT');
    console.log('\nMigration complete.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void run();
