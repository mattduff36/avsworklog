import { config } from 'dotenv';
import { resolve, join } from 'path';
import fs from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260323_work_shifts.sql';

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
  }

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

    console.log(`Applying ${MIGRATION_FILE}...`);
    await client.query(sql);

    const { rows } = await client.query<{
      templates: string;
      employees: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM work_shift_templates) AS templates,
        (SELECT COUNT(*)::text FROM employee_work_shifts) AS employees
    `);

    console.log(`Work shift templates: ${rows[0]?.templates || '0'}`);
    console.log(`Employee work shift rows: ${rows[0]?.employees || '0'}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
