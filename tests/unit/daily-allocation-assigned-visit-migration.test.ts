import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261003_daily_allocation_assigned_visit.sql'),
  'utf8',
);

describe('daily allocation assigned visit migration', () => {
  it('creates one locked, idempotent job-drop command for authenticated callers', () => {
    expect(migration.startsWith('-- finalise-phase: predeploy')).toBe(true);
    expect(migration).toContain("'assigned_visit_create'");
    expect(migration).toContain('private.daily_allocation_request_replay');
    expect(migration).toContain('private.daily_allocation_request_store');
    expect(migration).toContain('private.daily_allocation_is_session_interval');
    expect(migration).toContain("RAISE EXCEPTION 'HARD_CONFLICT'");
    expect(migration).toContain("RAISE EXCEPTION 'CONFLICT_NOT_PRESENT'");
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public, private');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.create_daily_allocation_assigned_visit_v2');
    expect(migration).toContain('TO authenticated');
    expect(migration).toContain('FROM PUBLIC, anon, service_role');
    expect(migration).not.toContain('public.upsert_daily_allocation_visit_v2');
    expect(migration).not.toContain('public.assign_daily_allocation_labour_v2');
    expect(migration).not.toContain('public.create_daily_allocation_conflict_override_v2');

    const planLock = migration.indexOf('private.lock_daily_allocation_plan_day');
    const resourceLock = migration.indexOf('private.lock_daily_allocation_resource_keys');
    const jobLock = migration.indexOf('private.daily_allocation_v2_lock_job_source');
    const versionBump = migration.indexOf('private.bump_daily_allocation_plan_version');
    const visitInsert = migration.indexOf('INSERT INTO public.daily_allocation_visits');
    const overrideInsert = migration.indexOf('INSERT INTO public.daily_allocation_conflict_overrides');
    const labourAssert = migration.indexOf('private.daily_allocation_v2_assert_labour_assignable');
    const labourInsert = migration.indexOf('INSERT INTO public.daily_allocation_visit_labour');
    expect(planLock).toBeGreaterThan(0);
    expect(planLock).toBeLessThan(resourceLock);
    expect(resourceLock).toBeLessThan(jobLock);
    expect(jobLock).toBeLessThan(versionBump);
    expect(versionBump).toBeLessThan(visitInsert);
    expect(visitInsert).toBeLessThan(overrideInsert);
    expect(overrideInsert).toBeLessThan(labourAssert);
    expect(labourAssert).toBeLessThan(labourInsert);
    expect(migration.match(/private\.bump_daily_allocation_plan_version/g)).toHaveLength(1);
  });
});
