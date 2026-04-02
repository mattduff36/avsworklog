import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import {
  remapResponsesByFieldKey,
  type ExistingAttachmentResponse,
} from '../lib/workshop-attachments/response-remap';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const targetTemplateName = '6 Week Inspection - HGV';

interface TemplateRow {
  id: string;
  name: string;
}

interface VersionRow {
  id: string;
  version_number: number;
  status: string;
}

interface SectionRow {
  id: string;
  section_key: string;
  title: string;
  description: string | null;
  sort_order: number;
}

interface FieldRow {
  id: string;
  section_id: string;
  field_key: string;
  label: string;
  help_text: string | null;
  field_type: string;
  is_required: boolean;
  sort_order: number;
  options_json: Record<string, unknown> | null;
  validation_json: Record<string, unknown> | null;
}

interface AttachmentRow {
  id: string;
  status: string | null;
}

interface FieldTargetInfo {
  field_id: string;
  section_key: string;
}

interface SnapshotPayload {
  template_id: string;
  version_id: string;
  generated_at: string;
  sections: Array<{
    id: string;
    section_key: string;
    title: string;
    description: string | null;
    sort_order: number;
    fields: Array<{
      id: string;
      field_key: string;
      label: string;
      help_text: string | null;
      field_type: string;
      is_required: boolean;
      sort_order: number;
      options_json: Record<string, unknown> | null;
      validation_json: Record<string, unknown> | null;
    }>;
  }>;
}

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  process.exit(1);
}

async function loadTargetVersion(client: pg.Client, templateId: string): Promise<VersionRow> {
  const versionResult = await client.query<VersionRow>(
    `select id, version_number, status
     from workshop_attachment_template_versions
     where template_id = $1
     order by case when status = 'published' then 0 else 1 end, version_number desc
     limit 1`,
    [templateId],
  );

  if (versionResult.rows.length === 0) {
    throw new Error('No template version found for target template');
  }

  return versionResult.rows[0];
}

async function loadSnapshotSource(client: pg.Client, templateId: string, versionId: string): Promise<{
  snapshot: SnapshotPayload;
  fieldTargets: Map<string, FieldTargetInfo>;
}> {
  const sectionsResult = await client.query<SectionRow>(
    `select id, section_key, title, description, sort_order
     from workshop_attachment_template_sections
     where version_id = $1
     order by sort_order asc, created_at asc`,
    [versionId],
  );

  if (sectionsResult.rows.length === 0) {
    throw new Error('Target version has no sections');
  }

  const sectionIds = sectionsResult.rows.map((section) => section.id);
  const fieldsResult = await client.query<FieldRow>(
    `select id, section_id, field_key, label, help_text, field_type, is_required, sort_order, options_json, validation_json
     from workshop_attachment_template_fields
     where section_id = any($1::uuid[])
     order by sort_order asc, created_at asc`,
    [sectionIds],
  );

  if (fieldsResult.rows.length === 0) {
    throw new Error('Target version has no fields');
  }

  const sectionById = new Map<string, SectionRow>();
  const fieldsBySectionId = new Map<string, FieldRow[]>();
  const fieldTargets = new Map<string, FieldTargetInfo>();

  for (const section of sectionsResult.rows) {
    sectionById.set(section.id, section);
    fieldsBySectionId.set(section.id, []);
  }

  for (const field of fieldsResult.rows) {
    const list = fieldsBySectionId.get(field.section_id) || [];
    list.push(field);
    fieldsBySectionId.set(field.section_id, list);
    const section = sectionById.get(field.section_id);
    if (!section) continue;
    fieldTargets.set(field.field_key, {
      field_id: field.id,
      section_key: section.section_key,
    });
  }

  const snapshot: SnapshotPayload = {
    template_id: templateId,
    version_id: versionId,
    generated_at: new Date().toISOString(),
    sections: sectionsResult.rows.map((section) => ({
      id: section.id,
      section_key: section.section_key,
      title: section.title,
      description: section.description,
      sort_order: section.sort_order,
      fields: (fieldsBySectionId.get(section.id) || []).map((field) => ({
        id: field.id,
        field_key: field.field_key,
        label: field.label,
        help_text: field.help_text,
        field_type: field.field_type,
        is_required: field.is_required,
        sort_order: field.sort_order,
        options_json: field.options_json,
        validation_json: field.validation_json,
      })),
    })),
  };

  return { snapshot, fieldTargets };
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

    const templateResult = await client.query<TemplateRow>(
      `select id, name
       from workshop_attachment_templates
       where lower(name) = lower($1)
       limit 1`,
      [targetTemplateName],
    );

    if (templateResult.rows.length === 0) {
      throw new Error(`Template not found: ${targetTemplateName}`);
    }

    const template = templateResult.rows[0];
    const version = await loadTargetVersion(client, template.id);
    const { snapshot, fieldTargets } = await loadSnapshotSource(client, template.id, version.id);

    const attachmentsResult = await client.query<AttachmentRow>(
      `select id, status
       from workshop_task_attachments
       where template_id = $1
       order by created_at asc`,
      [template.id],
    );

    const attachments = attachmentsResult.rows;
    console.log(`Template: ${template.name}`);
    console.log(`Target version: v${version.version_number} (${version.status})`);
    console.log(`Attachments to backfill: ${attachments.length}`);
    console.log(`Target field keys: ${fieldTargets.size}`);

    let processedAttachments = 0;
    let failedAttachments = 0;
    let mappedResponses = 0;
    let unmappedResponses = 0;
    let deletedResponses = 0;
    const unmappedKeys = new Map<string, number>();

    for (const attachment of attachments) {
      await client.query('begin');
      try {
        const responsesResult = await client.query<ExistingAttachmentResponse>(
          `select field_key, response_value, response_json
           from workshop_attachment_field_responses
           where attachment_id = $1`,
          [attachment.id],
        );

        const existingResponses = responsesResult.rows;
        const remapResult = remapResponsesByFieldKey(existingResponses, fieldTargets);

        for (const key of remapResult.unmappedKeys) {
          unmappedResponses += 1;
          unmappedKeys.set(key, (unmappedKeys.get(key) || 0) + 1);
        }
        mappedResponses += remapResult.mapped.length;

        const deleteResult = await client.query(
          `delete from workshop_attachment_field_responses
           where attachment_id = $1`,
          [attachment.id],
        );
        deletedResponses += deleteResult.rowCount || 0;

        for (const row of remapResult.mapped) {
          await client.query(
            `insert into workshop_attachment_field_responses
             (attachment_id, field_id, section_key, field_key, response_value, response_json)
             values ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              attachment.id,
              row.field_id,
              row.section_key,
              row.field_key,
              row.response_value,
              row.response_json ? JSON.stringify(row.response_json) : null,
            ],
          );
        }

        await client.query(
          `insert into workshop_attachment_schema_snapshots
             (attachment_id, template_version_id, snapshot_json, created_by)
           values ($1, $2, $3::jsonb, null)
           on conflict (attachment_id)
           do update set
             template_version_id = excluded.template_version_id,
             snapshot_json = excluded.snapshot_json,
             created_at = now()`,
          [attachment.id, version.id, JSON.stringify(snapshot)],
        );

        await client.query('commit');
        processedAttachments += 1;
      } catch (error) {
        await client.query('rollback');
        failedAttachments += 1;
        const rowError = error as { message?: string };
        console.error(`Failed attachment ${attachment.id}: ${rowError.message || error}`);
      }
    }

    console.log('Backfill completed');
    console.log(`Processed attachments: ${processedAttachments}`);
    console.log(`Failed attachments: ${failedAttachments}`);
    console.log(`Deleted old response rows: ${deletedResponses}`);
    console.log(`Mapped response rows: ${mappedResponses}`);
    console.log(`Unmapped response rows: ${unmappedResponses}`);

    if (unmappedKeys.size > 0) {
      console.log('Unmapped response keys (field_key -> count):');
      for (const [key, count] of [...unmappedKeys.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`- ${key}: ${count}`);
      }
    }
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
