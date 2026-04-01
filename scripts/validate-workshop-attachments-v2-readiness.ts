import { config } from 'dotenv';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import pg from 'pg';
import type { AttachmentSnapshotForMapping } from '../lib/workshop-attachments/legacy-response-mapper';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  process.exit(1);
}

interface AttachmentReadinessRow {
  attachment_id: string;
  template_id: string;
  template_name: string;
  status: 'pending' | 'completed';
  snapshot_json: AttachmentSnapshotForMapping | null;
}

interface FieldResponseCountRow {
  attachment_id: string;
  field_response_count: number;
}

interface ReadinessIssue {
  attachment_id: string;
  template_id: string;
  template_name: string;
  reason: string;
}

interface ReadinessReport {
  generated_at: string;
  summary: {
    total_attachments: number;
    attachments_with_snapshot: number;
    attachments_without_snapshot: number;
    attachments_with_v2_field_responses: number;
    blocker_count: number;
  };
  readiness_issues: ReadinessIssue[];
}

function validateSnapshotStructure(snapshot: AttachmentSnapshotForMapping | null): string | null {
  if (!snapshot) return 'Missing schema snapshot';
  if (!Array.isArray(snapshot.sections) || snapshot.sections.length === 0) return 'Snapshot has no sections';

  for (const section of snapshot.sections) {
    if (!section.section_key || !section.section_key.trim()) return 'Snapshot section missing section_key';
    if (!Array.isArray(section.fields) || section.fields.length === 0) {
      return `Snapshot section ${section.section_key} has no fields`;
    }
    for (const field of section.fields) {
      if (!field.field_key || !field.field_key.trim()) {
        return `Snapshot section ${section.section_key} has a field without field_key`;
      }
    }
  }

  return null;
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

    const attachmentsResult = await client.query<AttachmentReadinessRow>(
      `select
         a.id as attachment_id,
         a.template_id,
         t.name as template_name,
         a.status,
         s.snapshot_json
       from workshop_task_attachments a
       inner join workshop_attachment_templates t on t.id = a.template_id
       left join workshop_attachment_schema_snapshots s on s.attachment_id = a.id
       order by a.created_at asc`,
    );
    const attachments = attachmentsResult.rows;
    const attachmentIds = attachments.map((row) => row.attachment_id);

    const fieldResponseCountResult = attachmentIds.length > 0
      ? await client.query<FieldResponseCountRow>(
          `select attachment_id, count(*)::int as field_response_count
           from workshop_attachment_field_responses
           where attachment_id = any($1::uuid[])
           group by attachment_id`,
          [attachmentIds],
        )
      : { rows: [] as FieldResponseCountRow[] };

    const fieldResponseCountByAttachmentId = new Map(
      fieldResponseCountResult.rows.map((row) => [row.attachment_id, Number(row.field_response_count)]),
    );

    const readinessIssues: ReadinessIssue[] = [];

    for (const attachment of attachments) {
      const snapshotError = validateSnapshotStructure(attachment.snapshot_json);
      if (snapshotError) {
        readinessIssues.push({
          attachment_id: attachment.attachment_id,
          template_id: attachment.template_id,
          template_name: attachment.template_name,
          reason: snapshotError,
        });
      }

      const fieldCount = fieldResponseCountByAttachmentId.get(attachment.attachment_id) || 0;
      if (
        attachment.status === 'completed'
        && attachment.snapshot_json
        && attachment.snapshot_json.sections?.length
        && fieldCount === 0
      ) {
        readinessIssues.push({
          attachment_id: attachment.attachment_id,
          template_id: attachment.template_id,
          template_name: attachment.template_name,
          reason: 'Completed attachment has no V2 field responses stored',
        });
      }
    }

    const report: ReadinessReport = {
      generated_at: new Date().toISOString(),
      summary: {
        total_attachments: attachments.length,
        attachments_with_snapshot: attachments.filter((row) => Boolean(row.snapshot_json)).length,
        attachments_without_snapshot: attachments.filter((row) => !row.snapshot_json).length,
        attachments_with_v2_field_responses: fieldResponseCountByAttachmentId.size,
        blocker_count: readinessIssues.length,
      },
      readiness_issues: readinessIssues,
    };

    const outputDir = resolve(process.cwd(), 'reports', 'workshop-attachments');
    mkdirSync(outputDir, { recursive: true });
    const outputFile = resolve(outputDir, 'v2-cutover-readiness-report.json');
    writeFileSync(outputFile, JSON.stringify(report, null, 2), 'utf-8');
    const latestAlias = resolve(outputDir, 'latest-v2-cutover-readiness-report.json');
    writeFileSync(latestAlias, JSON.stringify(report, null, 2), 'utf-8');

    console.log('Readiness report:', outputFile);
    console.log('Latest alias:', latestAlias);
    console.log('Summary:', report.summary);

    if (report.summary.blocker_count > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Readiness validation failed:', pgError.message || error);
    if (pgError.detail) console.error('Detail:', pgError.detail);
    if (pgError.hint) console.error('Hint:', pgError.hint);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

run();
