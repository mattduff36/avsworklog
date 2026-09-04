import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { PLANT_LEGACY_MISSING_SITE_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import { getReminderActionDueState } from '@/lib/utils/reminder-action-due';
import { canIgnoreReminderAction } from '@/lib/utils/reminder-action-permissions';

const readSql = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8').replace(/\r\n/g, '\n');

const migration = readSql('supabase/migrations/20260817_plant_legacy_missing_site_actions.sql');
const rollback = readSql('supabase/rollback/20260817_plant_legacy_missing_site_actions.sql');
const enforcement = readSql('supabase/migrations/20260813_zz_daily_allocation_enforcement.sql');
const allocationModule = readSql('supabase/migrations/20260813_daily_allocation_module.sql');

describe('plant legacy missing-site actions', () => {
  it('MIG-001 keeps the shared allocation function signature and adds a plant-only helper', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION private.apply_plant_inspection_job_fields(');
    expect(migration).toContain('p_source_type TEXT,');
    expect(migration).toContain('p_source_id UUID,');
    expect(migration).toContain('p_job_code TEXT,');
    expect(migration).toContain('p_require_valid BOOLEAN');
    expect(migration).toContain('RETURN private.apply_allocation_job_fields(');
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION private.apply_allocation_job_fields(');
    expect(allocationModule).toContain('CREATE OR REPLACE FUNCTION private.apply_allocation_job_fields(\n  p_source_type TEXT,\n  p_source_id UUID,\n  p_job_code TEXT,\n  p_require_valid BOOLEAN\n)');
    expect(migration).toContain("p_source_type = 'legacy_quote' AND p_source_id IS NOT NULL");
    expect(migration).toContain("RAISE EXCEPTION 'JOB_NOT_FOUND'");
    expect(migration).toContain("RAISE EXCEPTION 'JOB_REQUIRED'");
    expect(migration).toContain('ON CONFLICT (dedupe_key) WHERE status = \'open\' DO UPDATE');
    expect(migration).toContain('SELECT DISTINCT ON (');
    expect(migration).toContain('due_at');
    expect(migration).toContain("INTERVAL '48 hours'");
    expect(migration).toContain('CREATE TRIGGER plant_inspections_legacy_missing_site_action');
    expect(migration).toContain('AFTER INSERT OR UPDATE ON public.plant_inspections');
    expect(migration).toContain('REVOKE ALL ON FUNCTION private.apply_plant_inspection_job_fields(TEXT, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('REVOKE ALL ON FUNCTION private.ensure_plant_legacy_missing_site_action() FROM PUBLIC, anon, authenticated');
    expect(migration).not.toContain('CREATE POLICY');
    expect(migration).not.toContain('GRANT INSERT ON public.reminder_actions');
  });

  it('DBJ-001/002/003 scopes missing-address relaxation to exact plant legacy sources', () => {
    expect(migration).toContain('private.apply_plant_inspection_job_fields');
    expect(migration).toContain('FROM public.legacy_quotes');
    expect(migration).toContain('NEW.status = \'submitted\'');
    expect(enforcement).toContain('private.apply_allocation_job_fields(');
    expect(allocationModule).toContain("RAISE EXCEPTION 'JOB_MISSING_SITE'");
    expect(migration).not.toContain("RAISE EXCEPTION 'JOB_MISSING_SITE'");
  });

  it('ACT-001/002 only creates an unassigned Action on submitted insert or draft-to-submitted', () => {
    expect(migration).toContain("IF NEW.status IS DISTINCT FROM 'submitted' THEN");
    expect(migration).toContain("IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN");
    expect(migration).toContain("'system_generated'");
    expect(migration).toContain(PLANT_LEGACY_MISSING_SITE_WORKFLOW_KEY);
    expect(migration).not.toContain('INSERT INTO public.reminders');
  });

  it('ACT-003 preserves the first deadline on repeated open detections', () => {
    const conflictBlock = migration.slice(migration.indexOf('ON CONFLICT (dedupe_key) WHERE status = \'open\' DO UPDATE'));
    const firstConflict = conflictBlock.slice(0, conflictBlock.indexOf('END;'));
    expect(firstConflict).toContain('last_detected_at = EXCLUDED.last_detected_at');
    expect(firstConflict).not.toContain('due_at =');
    expect(firstConflict).not.toContain('first_detected_at =');
  });

  it('RBK-001 restores strict plant validation without deleting Actions or due_at', () => {
    expect(rollback).toContain('DROP TRIGGER IF EXISTS plant_inspections_legacy_missing_site_action');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS private.apply_plant_inspection_job_fields(TEXT, UUID, TEXT, BOOLEAN)');
    expect(rollback).toContain('private.apply_allocation_job_fields(');
    expect(rollback).toContain("RAISE EXCEPTION 'JOB_REQUIRED'");
    expect(rollback).not.toContain('DROP COLUMN due_at');
    expect(rollback).not.toContain('DELETE FROM public.reminder_actions');
    expect(rollback).not.toContain('DROP TABLE');
  });

  it('SEC-001 and UI ignore rules keep inspectors from creating or hiding Actions', () => {
    const ignoreRoute = readFileSync(
      resolve(process.cwd(), 'app/api/actions/[id]/ignore/route.ts'),
      'utf8'
    );
    const workflows = readFileSync(
      resolve(process.cwd(), 'lib/config/reminder-workflows.ts'),
      'utf8'
    );
    const actionsPage = readFileSync(
      resolve(process.cwd(), 'app/(dashboard)/actions/page.tsx'),
      'utf8'
    );

    expect(canIgnoreReminderAction(PLANT_LEGACY_MISSING_SITE_WORKFLOW_KEY)).toBe(false);
    expect(canIgnoreReminderAction('fleet_inspection_overdue')).toBe(true);
    expect(ignoreRoute).toContain('canIgnoreReminderAction(action.workflow_key)');
    expect(workflows).toContain("id: 'legacy-job-addresses'");
    expect(workflows).toContain(PLANT_LEGACY_MISSING_SITE_WORKFLOW_KEY);
    expect(actionsPage).toContain('PLANT_LEGACY_MISSING_SITE_WORKFLOW_KEY');
    expect(migration).toContain('SECURITY DEFINER');
  });

  it('exposes an exact 48-hour due state', () => {
    const due = getReminderActionDueState('2026-08-19T10:00:00.000Z', new Date('2026-08-19T11:00:00.000Z'));
    expect(due.overdue).toBe(true);
    expect(due.label).toContain('Overdue since');

    const upcoming = getReminderActionDueState('2026-08-19T12:00:00.000Z', new Date('2026-08-19T11:00:00.000Z'));
    expect(upcoming.overdue).toBe(false);
    expect(upcoming.label).toContain('Due');
  });
});
