import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260930_daily_allocation_sessions.sql'),
  'utf8',
);
const rollback = readFileSync(
  resolve(process.cwd(), 'supabase/rollback/20260930_daily_allocation_sessions.sql'),
  'utf8',
);

describe('daily allocation session migration', () => {
  it('enforces fixed London sessions without rewriting published history', () => {
    expect(migration).toContain('-- finalise-phase: predeploy');
    expect(migration).toContain('private.require_daily_allocation_v2_writer()');
    expect(migration).toContain('can_actor_manage_daily_allocation_team(p_team_id)');
    expect(migration).toContain("'session_normalize'");
    expect(migration).toContain("'plan_copy'");
    expect(migration).toContain("TIME '07:00', TIME '16:30'");
    expect(migration).toContain("TIME '07:00', TIME '12:00'");
    expect(migration).toContain("TIME '12:00', TIME '16:30'");
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF work_date, starts_at, ends_at');
    expect(migration).toContain('NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at');
    expect(migration).toContain('daily_allocation_visit_plant plant');
    expect(migration).toContain('Employee is absent or off shift');
    expect(migration).toContain('IF NOT p_apply THEN');
    expect(migration).toContain("RAISE EXCEPTION 'CONFLICT'");
    expect(migration).toContain('STALE_PLAN_VERSION');
    expect(migration).toContain('private.lock_daily_allocation_plan_day');
    expect(migration).toContain('DEFERRABLE INITIALLY IMMEDIATE');
    expect(migration).toContain('SET CONSTRAINTS');
    expect(migration).toContain('pg_temp.daily_allocation_session_plan');
    expect(migration).toContain('Normalize this visit to Full, AM, or PM before copying');
    expect(migration).toContain('list_my_daily_allocation_issued_plant');
    expect(migration).toContain('labour.profile_id = auth.uid()');
    expect(migration).not.toMatch(/UPDATE public\.daily_allocation_published_/i);
    expect(migration).not.toMatch(/DELETE FROM public\.daily_allocation_published_/i);
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.normalize_daily_allocation_sessions_v2');
    expect(migration).toContain('FROM PUBLIC, anon, service_role');
  });

  it('rolls back the session objects and keeps plan copy requests valid', () => {
    expect(rollback).toContain('DROP TRIGGER IF EXISTS daily_allocation_visits_session_guard');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.normalize_daily_allocation_sessions_v2');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.list_my_daily_allocation_issued_plant');
    expect(rollback).toContain("'plan_copy'");
    expect(rollback).toContain('CREATE OR REPLACE FUNCTION public.copy_daily_allocation_plan_v2');
    expect(rollback).toContain("SELECT 'addition', 'visit', rows.source_visit_id, rows.job_code, 'Visit'");
    expect(rollback).not.toContain('DROP TABLE public.daily_allocation_visits');
    expect(rollback).not.toContain('DELETE FROM private.daily_allocation_mutation_requests');
  });
});