import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  process.exit(1);
}

interface AttachmentRow {
  id: string;
  template_id: string;
}

interface VersionRow {
  id: string;
  status: string;
}

async function buildSnapshot(client: pg.Client, templateId: string) {
  const versionsResult = await client.query<VersionRow>(
    `select id, status
     from workshop_attachment_template_versions
     where template_id = $1
     order by version_number desc`,
    [templateId],
  );

  if (versionsResult.rows.length === 0) return null;
  const published = versionsResult.rows.find((row) => row.status === 'published');
  const activeVersion = published || versionsResult.rows[0];

  const sectionsResult = await client.query(
    `select id, section_key, title, description, sort_order
     from workshop_attachment_template_sections
     where version_id = $1
     order by sort_order asc`,
    [activeVersion.id],
  );

  if (sectionsResult.rows.length === 0) return null;

  const sectionIds = sectionsResult.rows.map((row) => row.id);
  const fieldsResult = await client.query(
    `select id, section_id, field_key, label, help_text, field_type, is_required, sort_order, options_json, validation_json
     from workshop_attachment_template_fields
     where section_id = any($1::uuid[])
     order by sort_order asc`,
    [sectionIds],
  );

  const fieldsBySectionId = new Map<string, unknown[]>();
  for (const field of fieldsResult.rows) {
    const arr = fieldsBySectionId.get(field.section_id) || [];
    arr.push({
      id: field.id,
      field_key: field.field_key,
      label: field.label,
      help_text: field.help_text || null,
      field_type: field.field_type,
      is_required: field.is_required,
      sort_order: field.sort_order,
      options_json: field.options_json || null,
      validation_json: field.validation_json || null,
    });
    fieldsBySectionId.set(field.section_id, arr);
  }

  return {
    template_version_id: activeVersion.id,
    snapshot_json: {
      template_id: templateId,
      version_id: activeVersion.id,
      generated_at: new Date().toISOString(),
      sections: sectionsResult.rows.map((section) => ({
        id: section.id,
        section_key: section.section_key,
        title: section.title,
        description: section.description || null,
        sort_order: section.sort_order,
        fields: fieldsBySectionId.get(section.id) || [],
      })),
    },
  };
}

async function run() {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected');

    const missingSnapshotsResult = await client.query<AttachmentRow>(
      `select a.id, a.template_id
       from workshop_task_attachments a
       left join workshop_attachment_schema_snapshots s on s.attachment_id = a.id
       where s.id is null
       order by a.created_at asc`,
    );

    const missingRows = missingSnapshotsResult.rows;
    console.log(`Attachments missing schema snapshot: ${missingRows.length}`);

    let inserted = 0;
    let skippedNoSchema = 0;

    for (const row of missingRows) {
      const snapshot = await buildSnapshot(client, row.template_id);
      if (!snapshot || snapshot.snapshot_json.sections.length === 0) {
        skippedNoSchema += 1;
        continue;
      }

      await client.query(
        `insert into workshop_attachment_schema_snapshots (attachment_id, template_version_id, snapshot_json, created_by)
         values ($1, $2, $3::jsonb, null)
         on conflict (attachment_id) do nothing`,
        [row.id, snapshot.template_version_id, JSON.stringify(snapshot.snapshot_json)],
      );

      inserted += 1;
    }

    console.log(`Inserted snapshots: ${inserted}`);
    console.log(`Skipped (template has no v2 schema): ${skippedNoSchema}`);
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Backfill failed:', pgError.message || error);
    if (pgError.detail) console.error('Detail:', pgError.detail);
    if (pgError.hint) console.error('Hint:', pgError.hint);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

run();
