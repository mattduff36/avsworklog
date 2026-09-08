import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

describe('delete-user annual leave migration contract', () => {
  it('installs tombstone lock, service_role RPC, and legacy suffix cleanup', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260907230000_delete_user_keep_data_annual_leave.sql'),
      'utf8'
    );

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ');
    expect(sql).toContain("full_name LIKE '% (Deleted User)'");
    expect(sql).toContain("full_name = '(Deleted User)'");
    expect(sql).toContain('guard_profile_deleted_at_immutability');
    expect(sql).toContain('NEW.deleted_at := OLD.deleted_at');
    expect(sql).toContain('guard_absence_deleted_profile_write');
    expect(sql).toMatch(/WHERE p\.id = NEW\.profile_id\s+FOR SHARE/u);
    expect(sql).not.toMatch(/WHERE p\.id = NEW\.profile_id\s+FOR KEY SHARE/u);
    expect(sql).not.toMatch(/WHERE p\.id = NEW\.profile_id\s+FOR (?:NO KEY )?UPDATE/u);
    expect(sql).toContain('IF NOT FOUND');
    expect(sql).toContain('missing profile');
    expect(sql).not.toMatch(/IF EXISTS \(\s*SELECT 1\s*FROM public\.profiles/u);
    expect(sql).toContain('delete_profile_open_year_annual_leave_bookings');
    expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(sql).toContain("USING ERRCODE = '42501'");
    expect(sql).toContain("set_config('app.absence_historic_delete_bypass', 'on', true)");
    expect(sql).not.toContain("set_config('app.absence_archive_move'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.delete_profile_open_year_annual_leave_bookings(uuid) FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.delete_profile_open_year_annual_leave_bookings(uuid) FROM anon');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.delete_profile_open_year_annual_leave_bookings(uuid) FROM authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.delete_profile_open_year_annual_leave_bookings(uuid) TO service_role');
  });

  it('DEL-AL-REASON-SNAPSHOT: count and selected reason id come from one snapshot', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260907230000_delete_user_keep_data_annual_leave.sql'),
      'utf8'
    );

    expect(sql).toContain('COUNT(*) OVER () AS reason_count');
    expect(sql).not.toMatch(/SELECT COUNT\(\*\)\s+INTO v_reason_count/);
    expect((sql.match(/COUNT\(\*\) OVER \(\) AS reason_count/g) ?? []).length).toBe(2);
  });
});
