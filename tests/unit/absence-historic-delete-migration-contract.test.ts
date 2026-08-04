import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

function readMigration(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('absence historic delete migration contract', () => {
  it('ABS-DEL-05: installs historic delete guard with admin semantics and authorized RPCs', () => {
    const sql = readMigration('supabase/migrations/20260804_absence_historic_delete_guard.sql');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.guard_absence_historic_delete');
    expect(sql).toContain('SET search_path = public, pg_temp');
    expect(sql).toContain("current_setting('app.absence_archive_move'");
    expect(sql).toContain("current_setting('app.absence_historic_delete_bypass'");
    expect(sql).toContain('effective_is_admin()');
    expect(sql).toContain('OLD.date < CURRENT_DATE');
    expect(sql).toContain("OLD.status IN ('approved', 'processed')");
    expect(sql).not.toContain('COALESCE(OLD.auto_generated, FALSE) THEN');
    expect(sql).toContain('CREATE TRIGGER trg_guard_absence_historic_delete');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.can_actor_run_absence_global_delete');
    expect(sql).toContain('view_as_role_id()');
    expect(sql).toContain("absence_secondary_effective_cell(auth.uid(), 'see_manage_overview_all')");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.delete_absences_for_bulk_batch');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.delete_latest_generated_financial_year_absences');
    expect(sql).toContain('absence_financial_year_generations');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('DELETE FROM public.absence_financial_year_generations');
    expect(sql).toContain('can_actor_run_absence_global_delete()');
    expect(sql).toContain("set_config('app.absence_historic_delete_bypass', 'on', true)");
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.delete_absences_for_financial_year_undo');
  });

  it('ABS-DEL-06: keeps closed financial year guard and provides down migration', () => {
    const closedFySql = readMigration('supabase/migrations/20260312_absence_fy_archival.sql');
    expect(closedFySql).toContain('CREATE OR REPLACE FUNCTION guard_absence_closed_financial_year_mutation');
    expect(closedFySql).toContain('trg_guard_absence_closed_fy_delete');

    const downSql = readMigration('supabase/migrations/20260804_absence_historic_delete_guard_down.sql');
    expect(downSql).toContain('DROP TRIGGER IF EXISTS trg_guard_absence_historic_delete');
    expect(downSql).toContain('DROP FUNCTION IF EXISTS public.guard_absence_historic_delete');
    expect(downSql).toContain('DROP FUNCTION IF EXISTS public.delete_absences_for_bulk_batch');
    expect(downSql).toContain('DROP FUNCTION IF EXISTS public.delete_latest_generated_financial_year_absences');
    expect(downSql).not.toContain('guard_absence_closed_financial_year_mutation');
  });
});
