import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  buildBasicServiceFieldSignature,
  transformBasicServiceChecklistFields,
  type BasicServiceChecklistField,
} from '@/lib/workshop-attachments/basic-service-hgv-variants';
import { validateRequiredSchemaResponses } from '@/lib/workshop-attachments/schema-validation';
import { isV2FieldAnswered, type V2PdfFieldData } from '@/lib/pdf/workshop-attachment-pdf';
import type { AttachmentSchemaSection } from '@/types/workshop-attachments-v2';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

interface SnapshotSection {
  section_key: string;
  title: string;
  fields: Array<{
    field_key: string;
    label: string;
    field_type: string;
    is_required: boolean;
  }>;
}

async function loadChecklist(client: pg.Client, templateName: string): Promise<BasicServiceChecklistField[]> {
  const { rows } = await client.query<BasicServiceChecklistField>(`
    WITH latest AS (
      SELECT DISTINCT ON (v.template_id) v.id AS version_id
      FROM workshop_attachment_templates t
      INNER JOIN workshop_attachment_template_versions v ON v.template_id = t.id
      WHERE LOWER(t.name) = LOWER($1)
        AND v.status = 'published'
      ORDER BY v.template_id, v.version_number DESC
    )
    SELECT
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

describe('Basic Service HGV A/B clone applied database checks', () => {
  it('WAT-CLONE/RETIRE/SNAPSHOT: live schemas, retirement, completion path, and PDF labels hold', async () => {
    if (!connectionString) {
      throw new Error('Missing POSTGRES_URL_NON_POOLING/POSTGRES_URL for applied DB verification');
    }

    const url = new URL(connectionString);
    const client = new pg.Client({
      host: url.hostname,
      port: parseInt(url.port, 10) || 5432,
      database: url.pathname.slice(1),
      user: url.username,
      password: decodeURIComponent(url.password),
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    try {
      const { rows: templates } = await client.query<{ name: string; is_active: boolean }>(`
        SELECT name, is_active
        FROM workshop_attachment_templates
        WHERE LOWER(name) IN (
          LOWER('Basic Service (HGV)'),
          LOWER('Basic Service A (HGV)'),
          LOWER('Basic Service B (HGV)')
        )
        ORDER BY name;
      `);
      const byName = new Map(templates.map((row) => [row.name, row]));
      expect(byName.get('Basic Service (HGV)')?.is_active).toBe(false);
      expect(byName.get('Basic Service A (HGV)')?.is_active).toBe(true);
      expect(byName.get('Basic Service B (HGV)')?.is_active).toBe(true);

      // WAT-CONFLICT-001: exact published match still aborts when unpublished versions exist.
      const { rows: aTemplate } = await client.query<{ id: string }>(`
        SELECT id FROM workshop_attachment_templates WHERE LOWER(name) = LOWER('Basic Service A (HGV)') LIMIT 1
      `);
      const { rows: maxVersionRows } = await client.query<{ max_version: string }>(`
        SELECT COALESCE(MAX(version_number), 0)::text AS max_version
        FROM workshop_attachment_template_versions
        WHERE template_id = $1
      `, [aTemplate[0].id]);
      const probeVersionNumber = Number(maxVersionRows[0]?.max_version || '0') + 1000;
      const { rows: probeRows } = await client.query<{ id: string }>(`
        INSERT INTO workshop_attachment_template_versions (template_id, version_number, status)
        VALUES ($1, $2, 'draft')
        RETURNING id
      `, [aTemplate[0].id, probeVersionNumber]);
      const probeVersionId = probeRows[0]?.id;
      expect(probeVersionId).toBeTruthy();
      try {
        const migrationSQL = fs.readFileSync(
          path.join(process.cwd(), 'supabase/migrations/20260804_basic_service_hgv_a_b_clone.sql'),
          'utf-8',
        );
        let conflictError: unknown;
        try {
          await client.query(migrationSQL);
        } catch (error) {
          conflictError = error;
        }
        expect(String((conflictError as { message?: string })?.message || conflictError)).toMatch(
          /unpublished or extra versions alongside the published schema/i,
        );
        await client.query('ROLLBACK');
      } finally {
        await client.query(`
          DELETE FROM workshop_attachment_template_versions
          WHERE id = $1
        `, [probeVersionId]);
      }

      const { rows: versionCounts } = await client.query<{ name: string; version_count: string; published_count: string }>(`
        SELECT
          t.name,
          COUNT(v.id)::text AS version_count,
          COUNT(v.id) FILTER (WHERE v.status = 'published')::text AS published_count
        FROM workshop_attachment_templates t
        LEFT JOIN workshop_attachment_template_versions v ON v.template_id = t.id
        WHERE LOWER(t.name) IN (
          LOWER('Basic Service A (HGV)'),
          LOWER('Basic Service B (HGV)')
        )
        GROUP BY t.name
        ORDER BY t.name;
      `);
      for (const row of versionCounts) {
        expect(Number(row.version_count)).toBe(1);
        expect(Number(row.published_count)).toBe(1);
      }

      const source = await loadChecklist(client, 'Basic Service (HGV)');
      const a = await loadChecklist(client, 'Basic Service A (HGV)');
      const b = await loadChecklist(client, 'Basic Service B (HGV)');

      expect(buildBasicServiceFieldSignature(a)).toBe(
        buildBasicServiceFieldSignature(transformBasicServiceChecklistFields(source, 'omit_air_dryer')),
      );
      expect(buildBasicServiceFieldSignature(b)).toBe(
        buildBasicServiceFieldSignature(transformBasicServiceChecklistFields(source, 'renew_air_filter')),
      );

      const { rows: activeSelection } = await client.query<{ name: string }>(`
        SELECT name
        FROM workshop_attachment_templates
        WHERE is_active = true
          AND LOWER(name) LIKE LOWER('Basic Service%HGV%')
        ORDER BY name;
      `);
      expect(activeSelection.map((row) => row.name)).toEqual([
        'Basic Service A (HGV)',
        'Basic Service B (HGV)',
      ]);

      const { rows: snapshots } = await client.query<{
        status: string;
        snapshot_json: { sections: SnapshotSection[] };
      }>(`
        SELECT a.status::text AS status, s.snapshot_json
        FROM workshop_task_attachments a
        INNER JOIN workshop_attachment_templates t ON t.id = a.template_id
        INNER JOIN workshop_attachment_schema_snapshots s ON s.attachment_id = a.id
        WHERE LOWER(t.name) = LOWER('Basic Service (HGV)')
        ORDER BY a.status;
      `);

      expect(snapshots.length).toBeGreaterThan(0);
      const pending = snapshots.find((row) => row.status === 'pending');
      const completed = snapshots.find((row) => row.status === 'completed');
      expect(pending).toBeTruthy();
      expect(completed).toBeTruthy();

      for (const snapshot of snapshots) {
        const checklist = snapshot.snapshot_json.sections.find((section) => section.section_key === 'service_checklist');
        expect(checklist?.fields.some((field) => field.field_key === 'renew_air_dryer_filter')).toBe(true);
        expect(checklist?.fields.some((field) => field.field_key === 'clean_out_air_filter' && field.label === 'Clean out air filter')).toBe(true);
      }

      // WAT-SNAPSHOT-001: completion validates against immutable snapshot, not active template.
      const schemaRoute = fs.readFileSync(
        path.join(process.cwd(), 'app/api/workshop-tasks/attachments/[id]/schema/route.ts'),
        'utf-8',
      );
      expect(schemaRoute).toContain('getAdminSchemaSnapshotForAttachment');
      expect(schemaRoute).toContain('validateRequiredSchemaResponses(snapshotSections');
      expect(schemaRoute).not.toMatch(/is_active/);

      const pendingSections = pending!.snapshot_json.sections as unknown as AttachmentSchemaSection[];
      const filledResponses = pendingSections.flatMap((section) =>
        section.fields
          .filter((field) => field.is_required)
          .map((field) => ({
            section_key: section.section_key,
            field_key: field.field_key,
            response_value: field.field_type === 'signature' ? null : 'yes',
            response_json:
              field.field_type === 'signature'
                ? {
                    data_url: 'data:image/png;base64,abc',
                    signed_by_name: 'Test Technician',
                    signed_at: '2026-08-04T12:00:00.000Z',
                  }
                : null,
          })),
      );
      expect(validateRequiredSchemaResponses(pendingSections, filledResponses)).toEqual([]);

      // WAT-SNAPSHOT-002: completed snapshot still drives original labels for PDF rendering.
      const completedChecklist = completed!.snapshot_json.sections.find(
        (section) => section.section_key === 'service_checklist',
      );
      expect(completedChecklist).toBeTruthy();
      const pdfFields: V2PdfFieldData[] = completedChecklist!.fields.map((field) => ({
        field_key: field.field_key,
        label: field.label,
        field_type: field.field_type as V2PdfFieldData['field_type'],
        is_required: field.is_required,
        response_value: 'yes',
        response_json: null,
      }));
      expect(pdfFields.some((field) => field.label === 'Clean out air filter')).toBe(true);
      expect(pdfFields.some((field) => field.label === 'Renew air dryer filter')).toBe(true);
      expect(pdfFields.every((field) => isV2FieldAnswered(field))).toBe(true);
    } finally {
      await client.end();
    }
  });
});
