import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';
import {
  buildBasicServiceFieldSignature,
  transformBasicServiceChecklistFields,
  type BasicServiceChecklistField,
} from '../lib/workshop-attachments/basic-service-hgv-variants';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260804_basic_service_hgv_a_b_clone.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

interface TemplateRow {
  name: string;
  is_active: boolean;
  published_versions: string;
  template_count: string;
}

interface FieldRow extends BasicServiceChecklistField {
  template_name: string;
  section_key: string;
  section_title: string;
  section_description: string | null;
  section_sort_order: number;
}

async function loadChecklistFields(client: pg.Client, templateName: string): Promise<FieldRow[]> {
  const { rows } = await client.query<FieldRow>(`
    WITH latest AS (
      SELECT DISTINCT ON (v.template_id)
        t.name AS template_name,
        v.id AS version_id
      FROM workshop_attachment_templates t
      INNER JOIN workshop_attachment_template_versions v ON v.template_id = t.id
      WHERE LOWER(t.name) = LOWER($1)
        AND v.status = 'published'
      ORDER BY v.template_id, v.version_number DESC
    )
    SELECT
      latest.template_name,
      s.section_key,
      s.title AS section_title,
      s.description AS section_description,
      s.sort_order AS section_sort_order,
      f.field_key,
      f.label,
      f.field_type::text AS field_type,
      f.is_required,
      f.sort_order,
      f.help_text,
      f.options_json,
      f.validation_json
    FROM latest
    INNER JOIN workshop_attachment_template_sections s ON s.version_id = latest.version_id
    INNER JOIN workshop_attachment_template_fields f ON f.section_id = s.id
    WHERE s.section_key = 'service_checklist'
    ORDER BY f.sort_order, f.field_key;
  `, [templateName]);

  return rows;
}

async function captureOriginalSnapshotFingerprints(client: pg.Client) {
  const { rows } = await client.query<{ attachment_id: string; fingerprint: string; status: string }>(`
    SELECT
      attachment.id AS attachment_id,
      attachment.status::text AS status,
      md5(snapshot.snapshot_json::text) AS fingerprint
    FROM workshop_task_attachments attachment
    INNER JOIN workshop_attachment_templates template ON template.id = attachment.template_id
    INNER JOIN workshop_attachment_schema_snapshots snapshot ON snapshot.attachment_id = attachment.id
    WHERE LOWER(template.name) = LOWER('Basic Service (HGV)')
    ORDER BY attachment.id;
  `);
  return rows;
}

async function installVerificationSignatureFunction(client: pg.Client) {
  await client.query(`
    CREATE OR REPLACE FUNCTION pg_temp.basic_service_hgv_schema_signature(
      p_version_id UUID,
      p_mode TEXT DEFAULT NULL
    )
    RETURNS TEXT
    LANGUAGE sql
    STABLE
    AS $$
      SELECT COALESCE(
        string_agg(
          part,
          chr(30)
          ORDER BY section_sort_order, field_sort_order, field_key_sort
        ),
        ''
      )
      FROM (
        SELECT
          s.sort_order AS section_sort_order,
          COALESCE(f.sort_order, -1) AS field_sort_order,
          COALESCE(
            CASE
              WHEN p_mode = 'renew_air_filter' AND f.field_key = 'clean_out_air_filter' THEN 'renew_air_filter'
              ELSE f.field_key
            END,
            ''
          ) AS field_key_sort,
          concat_ws(
            chr(31),
            'S',
            s.section_key,
            s.title,
            COALESCE(s.description, ''),
            s.sort_order::text,
            CASE WHEN f.id IS NULL THEN 'NO_FIELDS' ELSE 'F' END,
            CASE
              WHEN f.id IS NULL THEN ''
              WHEN p_mode = 'renew_air_filter' AND f.field_key = 'clean_out_air_filter' THEN 'renew_air_filter'
              ELSE f.field_key
            END,
            CASE
              WHEN f.id IS NULL THEN ''
              WHEN p_mode = 'renew_air_filter' AND f.field_key = 'clean_out_air_filter' THEN 'Renew air filter'
              ELSE f.label
            END,
            COALESCE(f.help_text, ''),
            COALESCE(f.field_type::text, ''),
            COALESCE(f.is_required::text, ''),
            COALESCE(f.sort_order::text, ''),
            COALESCE(f.options_json::text, 'null'),
            COALESCE(f.validation_json::text, 'null')
          ) AS part
        FROM workshop_attachment_template_sections s
        LEFT JOIN workshop_attachment_template_fields f
          ON f.section_id = s.id
         AND NOT (
           p_mode IS NOT DISTINCT FROM 'omit_air_dryer'
           AND f.field_key = 'renew_air_dryer_filter'
         )
        WHERE s.version_id = p_version_id
      ) signature_parts;
    $$;
  `);
}

async function latestPublishedVersionId(client: pg.Client, templateName: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(`
    SELECT v.id
    FROM workshop_attachment_templates t
    INNER JOIN workshop_attachment_template_versions v ON v.template_id = t.id
    WHERE LOWER(t.name) = LOWER($1)
      AND v.status = 'published'
    ORDER BY v.version_number DESC
    LIMIT 1;
  `, [templateName]);
  if (!rows[0]?.id) {
    throw new Error(`Verification failed: no published version for ${templateName}`);
  }
  return rows[0].id;
}

async function verify(
  client: pg.Client,
  snapshotFingerprintsBefore: Array<{ attachment_id: string; fingerprint: string; status: string }>,
) {
  const { rows: templates } = await client.query<TemplateRow>(`
    SELECT
      t.name,
      t.is_active,
      (
        SELECT COUNT(*)::text
        FROM workshop_attachment_template_versions v
        WHERE v.template_id = t.id
          AND v.status = 'published'
      ) AS published_versions,
      (
        SELECT COUNT(*)::text
        FROM workshop_attachment_templates x
        WHERE LOWER(x.name) = LOWER(t.name)
      ) AS template_count
    FROM workshop_attachment_templates t
    WHERE LOWER(t.name) IN (
      LOWER('Basic Service (HGV)'),
      LOWER('Basic Service A (HGV)'),
      LOWER('Basic Service B (HGV)')
    )
    ORDER BY t.name;
  `);

  const byName = new Map(templates.map((row) => [row.name, row]));
  const requiredNames = ['Basic Service (HGV)', 'Basic Service A (HGV)', 'Basic Service B (HGV)'];

  for (const name of requiredNames) {
    const row = byName.get(name);
    if (!row) {
      throw new Error(`Verification failed: missing template "${name}"`);
    }
    if (Number(row.template_count) !== 1) {
      throw new Error(`Verification failed: "${name}" is not unique (count=${row.template_count})`);
    }
    if (Number(row.published_versions) !== 1) {
      throw new Error(
        `Verification failed: "${name}" must have exactly 1 published version, found ${row.published_versions}`,
      );
    }
  }

  if (byName.get('Basic Service (HGV)')?.is_active !== false) {
    throw new Error('Verification failed: original Basic Service (HGV) must be inactive');
  }
  if (byName.get('Basic Service A (HGV)')?.is_active !== true) {
    throw new Error('Verification failed: Basic Service A (HGV) must be active');
  }
  if (byName.get('Basic Service B (HGV)')?.is_active !== true) {
    throw new Error('Verification failed: Basic Service B (HGV) must be active');
  }

  const sourceFields = await loadChecklistFields(client, 'Basic Service (HGV)');
  const aFields = await loadChecklistFields(client, 'Basic Service A (HGV)');
  const bFields = await loadChecklistFields(client, 'Basic Service B (HGV)');

  const expectedA = transformBasicServiceChecklistFields(sourceFields, 'omit_air_dryer');
  const expectedB = transformBasicServiceChecklistFields(sourceFields, 'renew_air_filter');

  const actualASignature = buildBasicServiceFieldSignature(aFields);
  const actualBSignature = buildBasicServiceFieldSignature(bFields);
  const expectedASignature = buildBasicServiceFieldSignature(expectedA);
  const expectedBSignature = buildBasicServiceFieldSignature(expectedB);

  if (actualASignature !== expectedASignature) {
    throw new Error(
      `Verification failed: Basic Service A checklist mismatch\nexpected=${expectedASignature}\nactual=${actualASignature}`,
    );
  }
  if (actualBSignature !== expectedBSignature) {
    throw new Error(
      `Verification failed: Basic Service B checklist mismatch\nexpected=${expectedBSignature}\nactual=${actualBSignature}`,
    );
  }

  await installVerificationSignatureFunction(client);
  const sourceVersionId = await latestPublishedVersionId(client, 'Basic Service (HGV)');
  const aVersionId = await latestPublishedVersionId(client, 'Basic Service A (HGV)');
  const bVersionId = await latestPublishedVersionId(client, 'Basic Service B (HGV)');

  const { rows: fullSignatures } = await client.query<{ expected_a: string; actual_a: string; expected_b: string; actual_b: string }>(`
    SELECT
      pg_temp.basic_service_hgv_schema_signature($1::uuid, 'omit_air_dryer') AS expected_a,
      pg_temp.basic_service_hgv_schema_signature($2::uuid, NULL) AS actual_a,
      pg_temp.basic_service_hgv_schema_signature($1::uuid, 'renew_air_filter') AS expected_b,
      pg_temp.basic_service_hgv_schema_signature($3::uuid, NULL) AS actual_b;
  `, [sourceVersionId, aVersionId, bVersionId]);

  const full = fullSignatures[0];
  if (!full || full.expected_a !== full.actual_a) {
    throw new Error('Verification failed: full-schema signature mismatch for Basic Service A (HGV)');
  }
  if (full.expected_b !== full.actual_b) {
    throw new Error('Verification failed: full-schema signature mismatch for Basic Service B (HGV)');
  }

  const { rows: activeSelection } = await client.query<{ name: string }>(`
    SELECT name
    FROM workshop_attachment_templates
    WHERE is_active = true
      AND LOWER(name) LIKE LOWER('Basic Service%HGV%')
    ORDER BY name;
  `);
  const activeNames = activeSelection.map((row) => row.name);
  if (activeNames.includes('Basic Service (HGV)')) {
    throw new Error('Verification failed: inactive original still appears in active selection');
  }
  if (!activeNames.includes('Basic Service A (HGV)') || !activeNames.includes('Basic Service B (HGV)')) {
    throw new Error(`Verification failed: active selection missing A/B: ${activeNames.join(', ')}`);
  }

  const snapshotFingerprintsAfter = await captureOriginalSnapshotFingerprints(client);
  if (snapshotFingerprintsBefore.length !== snapshotFingerprintsAfter.length) {
    throw new Error('Verification failed: original Basic Service snapshot count changed');
  }
  for (let index = 0; index < snapshotFingerprintsBefore.length; index += 1) {
    const before = snapshotFingerprintsBefore[index];
    const after = snapshotFingerprintsAfter[index];
    if (
      before.attachment_id !== after.attachment_id
      || before.fingerprint !== after.fingerprint
      || before.status !== after.status
    ) {
      throw new Error(
        `Verification failed: original snapshot changed for attachment ${before.attachment_id}`,
      );
    }
  }
  const hadPending = snapshotFingerprintsBefore.some((row) => row.status === 'pending');
  const hadCompleted = snapshotFingerprintsBefore.some((row) => row.status === 'completed');
  if (hadPending || hadCompleted) {
    const { rows: keyCheck } = await client.query<{ pending_ok: boolean; completed_ok: boolean }>(`
      SELECT
        EXISTS (
          SELECT 1
          FROM workshop_task_attachments a
          INNER JOIN workshop_attachment_templates t ON t.id = a.template_id
          INNER JOIN workshop_attachment_schema_snapshots s ON s.attachment_id = a.id
          WHERE LOWER(t.name) = LOWER('Basic Service (HGV)')
            AND a.status = 'pending'
            AND s.snapshot_json::text LIKE '%renew_air_dryer_filter%'
            AND s.snapshot_json::text LIKE '%clean_out_air_filter%'
        ) AS pending_ok,
        EXISTS (
          SELECT 1
          FROM workshop_task_attachments a
          INNER JOIN workshop_attachment_templates t ON t.id = a.template_id
          INNER JOIN workshop_attachment_schema_snapshots s ON s.attachment_id = a.id
          WHERE LOWER(t.name) = LOWER('Basic Service (HGV)')
            AND a.status = 'completed'
            AND s.snapshot_json::text LIKE '%renew_air_dryer_filter%'
            AND s.snapshot_json::text LIKE '%clean_out_air_filter%'
        ) AS completed_ok;
    `);
    if (hadPending && !keyCheck[0]?.pending_ok) {
      throw new Error('Verification failed: pending original snapshot lost expected field keys');
    }
    if (hadCompleted && !keyCheck[0]?.completed_ok) {
      throw new Error('Verification failed: completed original snapshot lost expected field keys');
    }
  }

  const helperStillExists = await client.query(`
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        '_clone_basic_service_hgv_variant',
        '_basic_service_hgv_schema_signature'
      )
  `);
  if (helperStillExists.rows.length > 0) {
    throw new Error('Verification failed: temporary clone helper function was not dropped');
  }

  console.log('Verified templates:');
  for (const name of requiredNames) {
    const row = byName.get(name)!;
    console.log(
      `  - ${name}: active=${row.is_active} published_versions=${row.published_versions}`,
    );
  }
  console.log(`  - Basic Service A checklist signature: ${actualASignature}`);
  console.log(`  - Basic Service B checklist signature: ${actualBSignature}`);
  console.log(`  - Active Basic Service* selection: ${activeNames.join(', ')}`);
}

async function runMigration() {
  console.log('Running Basic Service HGV A/B clone migration...\n');

  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const snapshotFingerprintsBefore = await captureOriginalSnapshotFingerprints(client);
    console.log(`Captured ${snapshotFingerprintsBefore.length} original Basic Service snapshot fingerprint(s)`);

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSQL);
    console.log('Migration executed');

    await verify(client, snapshotFingerprintsBefore);
    console.log('Basic Service HGV A/B clone migration verified.');
  } catch (error) {
    console.error('Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigration();
