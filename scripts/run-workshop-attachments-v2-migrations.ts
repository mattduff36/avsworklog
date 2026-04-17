import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const migrationFiles = [
  'supabase/migrations/20260401_workshop_attachments_schema_v2.sql',
  'supabase/migrations/20260401_seed_hgv_6_week_template_v2.sql',
  'supabase/migrations/20260402_publish_hgv_6_week_template_full_v2.sql',
  'supabase/migrations/20260415_publish_hgv_6_week_signature_cleanup.sql',
  'supabase/migrations/20260413_publish_trailer_6_week_template_v2.sql',
  'supabase/migrations/20260417_publish_hgv_service_templates_v2.sql',
];

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  process.exit(1);
}

async function runMigrations() {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected');

    for (const file of migrationFiles) {
      console.log(`Running migration: ${file}`);
      const sql = readFileSync(resolve(process.cwd(), file), 'utf-8');
      await client.query(sql);
      console.log(`Completed: ${file}`);
    }

    const { rows: versionRows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_name = 'workshop_attachment_template_versions'`,
    );
    console.log(`Verification: workshop_attachment_template_versions exists = ${versionRows[0]?.count === 1 ? 'yes' : 'no'}`);

    const { rows: hgvTemplateRows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM workshop_attachment_templates WHERE LOWER(name) = LOWER($1)`,
      ['6 Week Inspection - HGV'],
    );
    console.log(`Verification: 6 Week Inspection - HGV templates found = ${hgvTemplateRows[0]?.count || 0}`);

    const { rows: trailerTemplateRows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM workshop_attachment_templates WHERE LOWER(name) = LOWER($1)`,
      ['6 Week Inspection - Trailer'],
    );
    console.log(`Verification: 6 Week Inspection - Trailer templates found = ${trailerTemplateRows[0]?.count || 0}`);

    const { rows: fullServiceTemplateRows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM workshop_attachment_templates WHERE LOWER(name) = LOWER($1)`,
      ['Full Service (HGV)'],
    );
    console.log(`Verification: Full Service (HGV) templates found = ${fullServiceTemplateRows[0]?.count || 0}`);

    const { rows: basicServiceTemplateRows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM workshop_attachment_templates WHERE LOWER(name) = LOWER($1)`,
      ['Basic Service (HGV)'],
    );
    console.log(`Verification: Basic Service (HGV) templates found = ${basicServiceTemplateRows[0]?.count || 0}`);

    console.log('Workshop attachments v2 migrations completed successfully');
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Migration failed:', pgError.message || error);
    if (pgError.detail) console.error('Detail:', pgError.detail);
    if (pgError.hint) console.error('Hint:', pgError.hint);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigrations();
