import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260422_publish_hgv_6_week_roadworthy_signature_restore.sql';

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
      declaration_required_count: string;
      restored_signature_count: string;
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
          WHERE f.field_key = 'vehicle_safe_roadworthy_declaration'
            AND f.is_required = true
        ) AS declaration_required_count,
        (
          SELECT COUNT(*)::text
          FROM latest_published lp
          JOIN workshop_attachment_template_sections s ON s.version_id = lp.id
          JOIN workshop_attachment_template_fields f ON f.section_id = s.id
          WHERE f.field_key = 'inspector_signature_rectification'
            AND f.label = 'Signature'
            AND f.field_type = 'signature'
            AND f.is_required = true
        ) AS restored_signature_count
    `);

    if (Number(rows[0]?.declaration_required_count || '0') !== 1) {
      throw new Error('Verification failed: roadworthy declaration is not marked required on the latest published HGV template');
    }
    if (Number(rows[0]?.restored_signature_count || '0') !== 1) {
      throw new Error('Verification failed: roadworthy rectification signature was not restored on the latest published HGV template');
    }

    console.log('HGV 6-week roadworthy signature restore migration verified.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
