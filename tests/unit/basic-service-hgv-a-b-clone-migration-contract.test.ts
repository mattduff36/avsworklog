import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

function readMigration(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('Basic Service HGV A/B clone migration contract', () => {
  const sql = readMigration('supabase/migrations/20260804_basic_service_hgv_a_b_clone.sql');
  const downSql = readMigration('supabase/migrations/20260804_basic_service_hgv_a_b_clone_down.sql');
  const runner = readMigration('scripts/run-basic-service-hgv-a-b-clone-migration.ts');
  const templatesRoute = readMigration('app/api/workshop-tasks/attachments/templates/route.ts');
  const taskRoute = readMigration('app/api/workshop-tasks/attachments/task/[taskId]/route.ts');

  it('WAT-CLONE-001: resolves a unique source published schema before cloning', () => {
    expect(sql).toContain("v_source_name CONSTANT TEXT := 'Basic Service (HGV)'");
    expect(sql).toContain('Expected exactly one "%" template, found %');
    expect(sql).toContain("AND v.status = 'published'");
    expect(sql).toContain("f.field_key = 'clean_out_air_filter'");
    expect(sql).toContain("f.field_key = 'renew_air_dryer_filter'");
    expect(sql).toContain('LOCK TABLE public.workshop_attachment_templates IN SHARE ROW EXCLUSIVE MODE');
  });

  it('WAT-CLONE-002 / WAT-CLONE-003: publishes exact metadata-preserving A/B transforms', () => {
    expect(sql).toContain("v_target_a_name CONSTANT TEXT := 'Basic Service A (HGV)'");
    expect(sql).toContain("v_target_b_name CONSTANT TEXT := 'Basic Service B (HGV)'");
    expect(sql).toContain("'omit_air_dryer'");
    expect(sql).toContain("'renew_air_filter'");
    expect(sql).toContain('v_source_field.sort_order');
    expect(sql).toContain("v_field_key := 'renew_air_filter'");
    expect(sql).toContain("v_field_label := 'Renew air filter'");
    expect(sql).toContain('_basic_service_hgv_schema_signature');
    expect(sql).toContain("p_mode IS NOT DISTINCT FROM 'omit_air_dryer'");
    expect(sql).toContain('COALESCE(f.options_json::text, \'null\')');
    expect(sql).toContain('COALESCE(f.validation_json::text, \'null\')');
    expect(sql).toContain('COALESCE(f.help_text, \'\')');
  });

  it('WAT-RETIRE-001 / WAT-IDEMPOTENCY-001 / WAT-CONFLICT-001: retires original safely', () => {
    expect(sql).toContain('SET is_active = false');
    expect(sql).toContain('WHERE id = v_source_id');
    expect(sql).toContain('already exists with a conflicting published schema');
    expect(sql).toContain('conflicting unpublished versions or attachments');
    expect(sql).toContain('has unpublished or extra versions alongside the published schema');
    expect(sql).toContain('v_existing_version_count <> 1');
    expect(sql).toContain('LEFT JOIN public.workshop_attachment_template_fields f');
    expect(sql).not.toContain('DELETE FROM public.workshop_attachment_template_versions');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public._clone_basic_service_hgv_variant');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public._basic_service_hgv_schema_signature');
    expect(sql).not.toContain('DELETE FROM public.workshop_attachment_templates');
    expect(sql).not.toContain('DELETE FROM public.workshop_task_attachments');
    expect(sql).not.toContain('DELETE FROM public.workshop_attachment_schema_snapshots');
  });

  it('WAT-SNAPSHOT-001 / WAT-SNAPSHOT-002: never mutates snapshots or original field rows', () => {
    expect(sql).not.toContain('UPDATE public.workshop_attachment_schema_snapshots');
    expect(sql).not.toContain('UPDATE public.workshop_attachment_template_fields');
    expect(sql).not.toContain('UPDATE public.workshop_task_attachments');
    expect(runner).toContain('captureOriginalSnapshotFingerprints');
    expect(runner).toContain('original snapshot changed for attachment');
    expect(runner).toContain('pending original snapshot lost expected field keys');
    expect(runner).toContain('completed original snapshot lost expected field keys');
  });

  it('WAT-VERIFY-001 / WAT-RETIRE-001: runner and selection APIs enforce retirement', () => {
    expect(runner).toContain('transformBasicServiceChecklistFields');
    expect(runner).toContain('buildBasicServiceFieldSignature');
    expect(runner).toContain('full-schema signature mismatch');
    expect(runner).toContain('pg_temp.basic_service_hgv_schema_signature');
    expect(runner).toContain('inactive original still appears in active selection');
    expect(templatesRoute).toContain(".eq('is_active', true)");
    expect(taskRoute).toContain('Template is inactive and cannot be attached to new tasks');
    expect(taskRoute).toContain('.select(\'id, is_active\')');
  });

  it('provides a non-destructive down migration', () => {
    expect(downSql).toContain("LOWER(name) = LOWER('Basic Service (HGV)')");
    expect(downSql).toContain('SET is_active = true');
    expect(downSql).toContain("LOWER('Basic Service A (HGV)')");
    expect(downSql).toContain("LOWER('Basic Service B (HGV)')");
    expect(downSql).toContain('SET is_active = false');
    expect(downSql).not.toContain('DELETE FROM');
  });
});
