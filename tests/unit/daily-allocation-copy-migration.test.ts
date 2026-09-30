import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260930_daily_allocation_copy_plan.sql'),
  'utf8',
);

describe('copy_daily_allocation_plan_v2', () => {
  it('is an authenticated, locked, next-day insert that does not rewrite the target', () => {
    expect(sql).toContain('-- finalise-phase: predeploy');
    expect(sql).toContain('private.require_daily_allocation_v2_writer()');
    expect(sql).toContain('can_actor_manage_daily_allocation_team(p_team_id)');
    expect(sql).toContain("'plan_copy'");
    expect(sql).toContain('IF NOT p_apply THEN');
    expect(sql).toContain("private.daily_allocation_request_replay(p_request_id, actor_id, 'plan_copy', payload)");
    expect(sql).toContain('p_target_date <> p_source_date + 1');
    expect(sql).toContain('private.lock_daily_allocation_plan_day(p_source_date, p_team_id)');
    expect(sql).toContain('private.lock_daily_allocation_plan_day(p_target_date, p_team_id)');
    expect(sql).toContain('private.lock_daily_allocation_resource_keys');
    expect(sql).toContain('STALE_PLAN_VERSION');
    expect(sql).toContain('TARGET_NEEDS_CONVERSION');
    expect(sql).toContain('WHERE rows.plant_selected;');
    expect(sql).toContain('private.bump_daily_allocation_plan_version');
    expect(sql).not.toMatch(/UPDATE public\.daily_allocation_visits/i);
    expect(sql).not.toMatch(/DELETE FROM public\.daily_allocation_visits/i);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.copy_daily_allocation_plan_v2');
    expect(sql).toContain('TO authenticated');
    expect(sql).toContain('FROM PUBLIC, anon, service_role');
  });
});
