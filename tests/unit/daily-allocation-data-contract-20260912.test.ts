import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName =
  '20260912_daily_allocation_idempotent_mutations_and_guided_conversion.sql';
const sql = readFileSync(
  resolve(process.cwd(), `supabase/migrations/${migrationName}`),
  'utf8'
).replace(/\r\n/g, '\n');

function functionSql(signature: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${signature}`);
  expect(start).toBeGreaterThan(-1);
  const next = sql.indexOf('\nCREATE OR REPLACE FUNCTION ', start + 1);
  return next === -1 ? sql.slice(start) : sql.slice(start, next);
}

function expectOrder(source: string, first: string, second: string) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  expect(firstIndex).toBeGreaterThan(-1);
  expect(secondIndex).toBeGreaterThan(firstIndex);
}

describe('DAFP immutable request ledger and replay contracts', () => {
  it('keeps request storage private, immutable, actor-bound, and SHA-256 hashed', () => {
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS private.daily_allocation_mutation_requests'
    );
    expect(sql).toContain('request_id UUID PRIMARY KEY');
    expect(sql).toContain('actor_id UUID NOT NULL');
    expect(sql).toContain('payload_hash TEXT NOT NULL');
    expect(sql).toContain('result JSONB NOT NULL');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON private.daily_allocation_mutation_requests');
    expect(sql).toContain(
      'REVOKE ALL ON TABLE private.daily_allocation_mutation_requests\n  FROM PUBLIC, anon, authenticated, service_role'
    );
    expect(sql).not.toContain('GRANT SELECT ON TABLE private.daily_allocation_mutation_requests');

    const replay = functionSql('private.daily_allocation_request_replay');
    expect(replay).toContain('existing.actor_id IS DISTINCT FROM p_actor_id');
    expect(replay).toContain('existing.action IS DISTINCT FROM p_action');
    expect(replay).toContain('existing.payload_hash IS DISTINCT FROM expected_hash');
    expect(replay).toContain("RAISE EXCEPTION 'REQUEST_ID_REUSED'");
    expect(replay).toContain('RETURN existing.result');
    expect(functionSql('private.daily_allocation_semantic_hash')).toContain("'sha256'");
  });

  it('runs the writer/runtime gate before replay and replay before entity lookup', () => {
    for (const signature of [
      'public.upsert_daily_allocation_visit_v2',
      'public.move_daily_allocation_visit_v2',
      'public.delete_daily_allocation_visit_v2',
      'public.assign_daily_allocation_labour_v2',
      'public.unassign_daily_allocation_labour_v2',
      'public.assign_daily_allocation_plant_v2',
      'public.unassign_daily_allocation_plant_v2',
      'public.create_daily_allocation_conflict_override_v2',
      'public.publish_daily_allocation_plan_v2',
    ]) {
      const fn = functionSql(signature);
      expectOrder(
        fn,
        'private.require_daily_allocation_v2_writer()',
        'private.daily_allocation_request_replay'
      );
    }
    const deleteVisit = functionSql('public.delete_daily_allocation_visit_v2');
    expectOrder(
      deleteVisit,
      'private.daily_allocation_request_replay',
      'deleted_id := public.delete_daily_allocation_visit_v2('
    );
  });
});

describe('DAFP guided conversion and v1 serialization', () => {
  it('requires complete source versions, explicit dispositions, canonical jobs and intervals', () => {
    const convert = functionSql('public.convert_daily_allocation_plan_day_v2');
    expect(convert).toContain('p_expected_source_fingerprint TEXT');
    expect(convert).toContain('p_visits JSONB');
    expect(convert).toContain('p_labour_drafts JSONB');
    expect(convert).toContain('p_plant_drafts JSONB');
    expect(convert).toContain('CONVERSION_DUPLICATE_INPUT');
    expect(convert).toContain('CONVERSION_LABOUR_SOURCE_MISMATCH');
    expect(convert).toContain('CONVERSION_PLANT_SOURCE_MISMATCH');
    expect(convert).toContain('CONVERSION_NULL_JOB_DISPOSITION_REQUIRED');
    expect(convert).toContain('private.daily_allocation_interval_is_valid');
    expect(convert).toContain('private.apply_allocation_job_fields');
    expect(convert).toContain('CONVERSION_JOB_MISMATCH');
    expect(convert).not.toContain('start_time');
    expect(convert).not.toMatch(
      /(UPDATE|DELETE FROM) public\.daily_(labour|plant)_allocation_drafts/
    );
  });

  it('takes the same team/date lock before every v1 conversion-state check', () => {
    const labourGuard = functionSql(
      'private.guard_daily_labour_allocation_draft_write'
    );
    const plantGuard = functionSql(
      'private.guard_daily_plant_allocation_draft_write'
    );
    const publishGuard = functionSql(
      'private.prepare_daily_allocation_publication'
    );
    for (const guard of [labourGuard, plantGuard, publishGuard]) {
      expectOrder(
        guard,
        'private.lock_daily_allocation_plan_day',
        'private.reject_converted_v1_daily_allocation_write'
      );
    }
    expect(publishGuard).toContain('SELECT DISTINCT profiles.team_id');
    expect(publishGuard).toContain('ORDER BY profiles.team_id');
    expect(publishGuard).toContain('WHERE profiles.id = ANY(NEW.scope_profile_ids)');
    const convert = functionSql('public.convert_daily_allocation_plan_day_v2');
    expectOrder(
      convert,
      'private.lock_daily_allocation_plan_day',
      'private.daily_allocation_conversion_source_fingerprint'
    );
  });
});

describe('DAFP CAS, ACL, and closed-state contract', () => {
  it('adds assignment row-version CAS and revokes obsolete overloads', () => {
    const labourAssign = functionSql('public.assign_daily_allocation_labour_v2');
    const labourDelete = functionSql('public.unassign_daily_allocation_labour_v2');
    const plantAssign = functionSql('public.assign_daily_allocation_plant_v2');
    const plantDelete = functionSql('public.unassign_daily_allocation_plant_v2');
    expect(labourAssign).toContain('p_expected_row_version INTEGER DEFAULT NULL');
    expect(labourAssign).toContain('existing.row_version <> p_expected_row_version');
    expect(plantAssign).toContain('p_expected_row_version INTEGER DEFAULT NULL');
    expect(plantAssign).toContain('existing.row_version <> p_expected_row_version');
    expect(labourDelete).toContain('existing.row_version <> p_expected_row_version');
    expect(plantDelete).toContain('existing.row_version <> p_expected_row_version');
    expect(labourDelete).toContain('p_expected_row_version IS NULL');
    expect(plantDelete).toContain('p_expected_row_version IS NULL');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.unassign_daily_allocation_labour_v2(UUID, INTEGER)'
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.unassign_daily_allocation_plant_v2(UUID, INTEGER)'
    );
  });

  it('leaves v2 runtime flags false and grants only authenticated wrapper execution', () => {
    expect(sql).toContain('SET board_enabled = FALSE, writes_enabled = FALSE');
    expect(sql).not.toContain('board_enabled = TRUE');
    expect(sql).not.toContain('writes_enabled = TRUE');
    expect(sql).not.toContain(
      'REVOKE ALL ON FUNCTION public.get_daily_allocation_v2_runtime() FROM PUBLIC, anon, service_role'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.convert_daily_allocation_plan_day_v2(UUID, DATE, TEXT, TEXT, JSONB, JSONB, JSONB) TO authenticated'
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.convert_daily_allocation_plan_day_v2(UUID, DATE, TEXT, TEXT, JSONB, JSONB, JSONB) FROM PUBLIC, anon, service_role'
    );
  });
});
