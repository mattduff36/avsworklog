import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260415_publish_hgv_6_week_signature_cleanup.sql';

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
    const migrationSql = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf8');
    console.log(`Applying ${MIGRATION_FILE}...`);
    await client.query(migrationSql);

    const { rows } = await client.query<{
      removed_field_count: string;
      inspector_label_ok: string;
      road_brake_label_ok: string;
    }>(`
      WITH latest_published AS (
        SELECT id
        FROM workshop_attachment_template_versions
        WHERE template_id = (
          SELECT id
          FROM workshop_attachment_templates
          WHERE LOWER(name) = LOWER('6 Week Inspection - HGV')
          LIMIT 1
        )
          AND status = 'published'
        ORDER BY version_number DESC
        LIMIT 1
      )
      SELECT
        (
          SELECT COUNT(*)::text
          FROM latest_published lp
          JOIN workshop_attachment_template_sections s ON s.version_id = lp.id
          JOIN workshop_attachment_template_fields f ON f.section_id = s.id
          WHERE f.field_key = 'inspector_signature_rectification'
        ) AS removed_field_count,
        (
          SELECT COUNT(*)::text
          FROM latest_published lp
          JOIN workshop_attachment_template_sections s ON s.version_id = lp.id
          JOIN workshop_attachment_template_fields f ON f.section_id = s.id
          WHERE f.field_key = 'signature_of_inspector'
            AND f.label = 'Signature of Inspector'
        ) AS inspector_label_ok,
        (
          SELECT COUNT(*)::text
          FROM latest_published lp
          JOIN workshop_attachment_template_sections s ON s.version_id = lp.id
          JOIN workshop_attachment_template_fields f ON f.section_id = s.id
          WHERE f.field_key = 'tester_signature'
            AND f.label = 'Signature of Road/Brake tester'
        ) AS road_brake_label_ok
    `);

    if (Number(rows[0]?.removed_field_count || '1') !== 0) {
      throw new Error('Verification failed: inspector_signature_rectification still exists on the latest published HGV template');
    }
    if (Number(rows[0]?.inspector_label_ok || '0') !== 1) {
      throw new Error('Verification failed: Signature of Inspector label not updated on the latest published HGV template');
    }
    if (Number(rows[0]?.road_brake_label_ok || '0') !== 1) {
      throw new Error('Verification failed: Signature of Road/Brake tester label not updated on the latest published HGV template');
    }

    console.log('HGV 6-week signature cleanup migration verified.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
