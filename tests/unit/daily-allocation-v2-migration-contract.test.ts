import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migrationName = '20260813_zzz_daily_allocation_v2_visit_model.sql';
const rollbackName = '20260813_zzz_disable_daily_allocation_v2.sql';

const v2Sql = readFileSync(resolve(process.cwd(), `supabase/migrations/${migrationName}`), 'utf8').replace(
  /\r\n/g,
  '\n'
);
const rollbackSql = readFileSync(resolve(process.cwd(), `supabase/rollback/${rollbackName}`), 'utf8').replace(
  /\r\n/g,
  '\n'
);
const runner = readFileSync(
  resolve(process.cwd(), 'scripts/run-daily-allocation-v2-migration.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

const v1Tables = [
  'daily_labour_allocation_drafts',
  'daily_plant_allocation_drafts',
  'daily_allocation_publications',
  'daily_allocation_labour_items',
  'daily_allocation_plant_items',
];

const v2PublicTables = [
  'daily_allocation_plan_days',
  'daily_allocation_visits',
  'daily_allocation_visit_labour',
  'daily_allocation_visit_plant',
  'daily_allocation_conflict_overrides',
  'daily_allocation_published_visits',
  'daily_allocation_published_labour',
  'daily_allocation_published_plant',
  'daily_allocation_published_overrides',
  'daily_allocation_publication_notifications',
];

const v2PlanningTables = [
  'daily_allocation_plan_days',
  'daily_allocation_visits',
  'daily_allocation_visit_labour',
  'daily_allocation_visit_plant',
  'daily_allocation_conflict_overrides',
];

function functionSql(qualifiedName: string): string {
  const start = v2Sql.indexOf(`CREATE OR REPLACE FUNCTION ${qualifiedName}`);
  expect(start).toBeGreaterThan(-1);
  const next = v2Sql.indexOf('\nCREATE OR REPLACE FUNCTION ', start + 1);
  return next === -1 ? v2Sql.slice(start) : v2Sql.slice(start, next);
}

function indexOrder(haystack: string, first: string, second: string) {
  const a = haystack.indexOf(first);
  const b = haystack.indexOf(second);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
}

describe('DA2-MIG-001 additive v2 visit model', () => {
  it('adds v2 tables without dropping or rewriting v1 publications', () => {
    expect(v2Sql).toContain('-- finalise-phase: predeploy');
    expect(v2Sql).toContain('CREATE TABLE IF NOT EXISTS public.daily_allocation_plan_days');
    expect(v2Sql).toContain('CREATE TABLE IF NOT EXISTS public.daily_allocation_visits');
    expect(v2Sql).toContain('CREATE TABLE IF NOT EXISTS public.daily_allocation_visit_labour');
    expect(v2Sql).toContain('CREATE TABLE IF NOT EXISTS public.daily_allocation_visit_plant');
    expect(v2Sql).toContain('CREATE TABLE IF NOT EXISTS public.daily_allocation_published_visits');
    expect(v2Sql).toContain('CREATE TABLE IF NOT EXISTS public.daily_allocation_published_labour');
    expect(v2Sql).toContain('CREATE TABLE IF NOT EXISTS public.daily_allocation_published_plant');
    expect(v2Sql).toContain('CREATE TABLE IF NOT EXISTS public.daily_allocation_publication_notifications');
    expect(v2Sql).toContain('ADD COLUMN IF NOT EXISTS snapshot_version INTEGER NOT NULL DEFAULT 1');
    expect(v2Sql).toContain('snapshot_version IN (1, 2)');
    expect(v2Sql).not.toContain('INSERT INTO public.daily_labour_allocation_drafts');
    expect(v2Sql).not.toContain('UPDATE public.daily_allocation_labour_items');
    expect(v2Sql).not.toContain('UPDATE public.daily_allocation_plant_items');
    expect(v2Sql).not.toMatch(/UPDATE public\.daily_allocation_publications\s+SET/);
    for (const table of v1Tables) {
      expect(v2Sql).not.toContain(`DROP TABLE public.${table}`);
      expect(v2Sql).not.toContain(`DROP TABLE IF EXISTS public.${table}`);
    }
  });

  it('keeps conversion free of inferred end times and dual-writes', () => {
    const convertFn = functionSql('public.convert_daily_allocation_plan_day_v2');
    expect(convertFn).toContain('ON CONFLICT (work_date, team_id) DO NOTHING');
    expect(convertFn).not.toContain('daily_labour_allocation_drafts');
    expect(convertFn).not.toContain('start_time');
    expect(convertFn).not.toContain('ends_at');
    expect(v2Sql).toContain("RAISE EXCEPTION 'V1_WRITES_DISABLED'");
    expect(
      '20260813_zz_daily_allocation_enforcement.sql'.localeCompare(migrationName)
    ).toBeLessThan(0);
  });

  it('records an idempotent pg.Client runner against the ledger', () => {
    expect(runner).toContain('POSTGRES_URL_NON_POOLING');
    expect(runner).not.toContain('POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL');
    expect(runner).toContain('requireSafeMigrationConnectionString');
    expect(runner).toContain('FINALISE_MIGRATION_LEDGER_SQL');
    expect(runner).toContain('decideFinaliseMigrationLedgerAction');
    expect(runner).toContain(migrationName);
    expect(runner).toContain('v2_gated');
    expect(runner).toContain('snapshot_version');
    expect(runner).toContain('writes_enabled = FALSE');
  });
});

describe('DA2-AUTH-001 v2 authorization contract', () => {
  it('keeps current permission helpers, view-as denial, and no user metadata', () => {
    expect(v2Sql).toContain('view_as_role_id() IS NOT NULL');
    expect(v2Sql).toContain('can_actor_manage_daily_allocation');
    expect(v2Sql).toContain('can_actor_manage_daily_allocation_team');
    expect(v2Sql).toContain('can_actor_view_daily_allocation');
    expect(v2Sql).toContain("effective_has_module_level('daily-allocation', 4)");
    expect(v2Sql).toContain("effective_module_access_level('daily-allocation') >= 5");
    expect(v2Sql).not.toContain('user_metadata');
    expect(v2Sql).not.toContain('raw_user_meta_data');
    expect(v2Sql).toContain("RAISE EXCEPTION 'V2_DISABLED'");
    expect(v2Sql).toContain('Not allowed to convert this daily allocation plan');
    expect(v2Sql).toContain('Not allowed to change this labour allocation');
  });

  it('enables RLS and withholds snapshot writes from clients', () => {
    for (const table of v2PublicTables) {
      expect(v2Sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(v2Sql).toContain('GRANT SELECT ON TABLE public.daily_allocation_published_visits TO authenticated');
    expect(v2Sql).toContain('GRANT SELECT ON TABLE public.daily_allocation_published_labour TO authenticated');
    expect(v2Sql).toContain('GRANT SELECT ON TABLE public.daily_allocation_publication_notifications TO authenticated');
    expect(v2Sql).not.toContain(
      'GRANT INSERT ON TABLE public.daily_allocation_published_visits TO authenticated'
    );
    expect(v2Sql).toContain('can_actor_view_daily_allocation(labour.profile_id)');
  });

  it('DA2-AUTH-001 / DA2-COMPAT-001 lets Level-2 employees read v2 publication headers they appear on', () => {
    const tableStart = v2Sql.indexOf('CREATE TABLE IF NOT EXISTS public.daily_allocation_published_labour');
    const policyStart = v2Sql.indexOf(
      'DROP POLICY IF EXISTS daily_allocation_publications_select ON public.daily_allocation_publications;'
    );
    const policyCreate = v2Sql.indexOf(
      'CREATE POLICY daily_allocation_publications_select ON public.daily_allocation_publications'
    );
    expect(tableStart).toBeGreaterThan(-1);
    expect(policyStart).toBeGreaterThan(tableStart);
    expect(policyCreate).toBeGreaterThan(policyStart);

    const nextPolicy = v2Sql.indexOf('\nDROP POLICY IF EXISTS ', policyCreate + 1);
    const policySql = nextPolicy === -1 ? v2Sql.slice(policyCreate) : v2Sql.slice(policyCreate, nextPolicy);

    expect(policySql).toContain("effective_module_access_level('daily-allocation') >= 5");
    expect(policySql).toContain("effective_has_module_level('daily-allocation', 4)");
    expect(policySql).toContain('can_actor_manage_daily_allocation_team(scope_team_id)');
    expect(policySql).toContain('published_by = auth.uid()');
    expect(policySql).toContain('auth.uid() = ANY (scope_profile_ids)');
    expect(policySql).toContain('FROM public.daily_allocation_labour_items items');
    expect(policySql).toContain('items.profile_id = auth.uid()');
    expect(policySql).toContain('can_actor_manage_daily_allocation(items.profile_id)');
    expect(policySql).toContain('FROM public.daily_allocation_published_labour labour');
    expect(policySql).toContain('labour.profile_id = auth.uid()');
    expect(policySql).toContain('can_actor_manage_daily_allocation(labour.profile_id)');
    expect(policySql).toContain("effective_has_module_level('daily-allocation', 2)");
    expect(policySql.match(/effective_has_module_level\('daily-allocation', 2\)/g)?.length).toBe(2);
    expect(policySql).not.toContain('user_metadata');
    expect(policySql).not.toContain('SECURITY DEFINER');
  });

  it('grants authenticated SELECT only on v2 planning tables, with no write policies', () => {
    const tableGrantRe =
      /GRANT\s+([A-Z, ]+?)\s+ON TABLE public\.(daily_allocation_[a-z_]+)\s+TO authenticated/g;
    const tableGrants = [...v2Sql.matchAll(tableGrantRe)].map((match) => ({
      privileges: match[1].split(',').map((part) => part.trim()),
      table: match[2],
    }));
    const v2TableGrants = tableGrants.filter((grant) => v2PublicTables.includes(grant.table));
    expect(v2TableGrants.map((grant) => grant.table).sort()).toEqual([...v2PublicTables].sort());
    for (const grant of v2TableGrants) {
      expect(grant.privileges).toEqual(['SELECT']);
    }
    expect(v2Sql).toContain('GRANT INSERT ON TABLE public.daily_allocation_publications TO authenticated');
    expect(v2Sql).not.toContain('GRANT SELECT ON TABLE private.daily_allocation_v2_runtime');
    expect(v2Sql).not.toMatch(/GRANT .* ON TABLE private\./);
    for (const table of v2PlanningTables) {
      expect(v2Sql).toContain(`GRANT SELECT ON TABLE public.${table} TO authenticated`);
      expect(v2Sql).not.toMatch(
        new RegExp(`GRANT (INSERT|UPDATE|DELETE|ALL)[\\s\\S]{0,80}ON TABLE public\\.${table} TO authenticated`)
      );
    }
    expect(v2Sql).toContain('DROP POLICY IF EXISTS daily_allocation_plan_days_write');
    expect(v2Sql).toContain('DROP POLICY IF EXISTS daily_allocation_visits_write');
    expect(v2Sql).toContain('DROP POLICY IF EXISTS daily_allocation_visit_labour_write');
    expect(v2Sql).toContain('DROP POLICY IF EXISTS daily_allocation_visit_plant_write');
    expect(v2Sql).toContain('DROP POLICY IF EXISTS daily_allocation_conflict_overrides_write');
    expect(v2Sql).not.toMatch(/CREATE POLICY daily_allocation_plan_days_write /);
    expect(v2Sql).not.toMatch(/CREATE POLICY daily_allocation_visits_write /);
    expect(v2Sql).not.toMatch(/CREATE POLICY daily_allocation_visit_labour_write /);
    expect(v2Sql).not.toMatch(/CREATE POLICY daily_allocation_visit_plant_write /);
    expect(v2Sql).not.toMatch(/CREATE POLICY daily_allocation_conflict_overrides_write /);
    expect(v2Sql).not.toMatch(
      /CREATE POLICY daily_allocation_(plan_days|visits|visit_labour|visit_plant|conflict_overrides)_\w+\s+ON public\.daily_allocation_\w+\s+FOR (INSERT|UPDATE|ALL|DELETE)/
    );
  });
});

describe('DA2-TIME-001 v2 interval schema', () => {
  it('stores TIMESTAMPTZ half-open London intervals with a 30-minute minimum', () => {
    expect(v2Sql).toContain('starts_at TIMESTAMPTZ NOT NULL');
    expect(v2Sql).toContain('ends_at TIMESTAMPTZ NOT NULL');
    expect(v2Sql).toContain("AT TIME ZONE 'Europe/London'");
    expect(v2Sql).toContain("tstzrange(starts_at, ends_at, '[)')");
    expect(v2Sql).toContain('daily_allocation_visits_london_same_day_check');
    expect(v2Sql).toContain('daily_allocation_visits_time_order_check CHECK (ends_at > starts_at)');
    expect(v2Sql).toContain("INTERVAL '30 minutes'");
    expect(v2Sql).toContain('private.daily_allocation_interval_is_valid');
    expect(v2Sql).toContain('private.daily_allocation_london_clock_is_grid');
    expect(v2Sql).toContain('daily_allocation_visits_trusted_grid_check');
    const gridFn = functionSql('private.daily_allocation_london_clock_is_grid');
    expect(gridFn).toContain("EXTRACT(SECOND FROM (p_at AT TIME ZONE 'Europe/London')) = 0");
    expect(gridFn).toContain("(EXTRACT(MINUTE FROM (p_at AT TIME ZONE 'Europe/London'))::INTEGER % 30) = 0");
    const intervalFn = functionSql('private.daily_allocation_interval_is_valid');
    expect(intervalFn).toContain('private.daily_allocation_london_clock_is_grid(p_starts_at)');
    expect(intervalFn).toContain('private.daily_allocation_london_clock_is_grid(p_ends_at)');
  });
});

describe('DA2-PLANT-001 one job per plant/day', () => {
  it('enforces overlap exclusion and one distinct job identity per plant day', () => {
    expect(v2Sql).toContain("RAISE EXCEPTION 'PLANT_JOB_CONFLICT'");
    expect(v2Sql).toContain('private.daily_allocation_plant_day_jobs');
    expect(v2Sql).toContain('daily_allocation_plant_day_jobs_registered_uniq');
    expect(v2Sql).toContain('daily_allocation_plant_day_jobs_hired_uniq');
    expect(v2Sql).toContain('daily_allocation_visit_plant_registered_excl_overlap');
    expect(v2Sql).toContain('daily_allocation_visit_plant_hired_excl_overlap');
    expect(v2Sql).toContain('daily_allocation_visit_labour_excl_overlap');
  });
});

describe('DA2-ROLL-001 disable-and-forward-fix', () => {
  it('disables v2 without destroying either model or reopening converted v1 writes', () => {
    expect(rollbackSql).toContain("WHERE module_name = 'daily-allocation'");
    expect(rollbackSql).toContain('writes_enabled = FALSE');
    expect(rollbackSql).toContain('board_enabled = FALSE');
    expect(rollbackSql).not.toMatch(/^\s*DROP TABLE\b/m);
    expect(rollbackSql).not.toMatch(/\bUPDATE\b[\s\S]*\bsnapshot_version\b/i);
    expect(v2Sql).toContain('Converted daily allocation plan days cannot be deleted');
    expect(v2Sql).toContain('writes_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    expect(v2Sql).toContain('board_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    expect(v2Sql).toContain('ON CONFLICT (singleton) DO NOTHING');
    expect(v2Sql).toContain('INSERT INTO private.daily_allocation_v2_runtime (singleton, board_enabled, writes_enabled)');
    expect(v2Sql).toContain('VALUES (TRUE, FALSE, FALSE)');
  });

  it('exposes an authenticated runtime RPC without private-table grants', () => {
    const runtimeFn = functionSql('public.get_daily_allocation_v2_runtime');
    expect(runtimeFn).toContain('SECURITY DEFINER');
    expect(runtimeFn).toContain('auth.uid()');
    expect(runtimeFn).toContain("effective_has_module_level('daily-allocation', 2)");
    expect(runtimeFn).toContain('board_enabled');
    expect(runtimeFn).toContain('writes_enabled');
    expect(v2Sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_daily_allocation_v2_runtime() TO authenticated, service_role'
    );
    expect(v2Sql).toContain(
      'REVOKE ALL ON FUNCTION public.get_daily_allocation_v2_runtime() FROM PUBLIC, anon'
    );
  });
});

describe('DA2-PUB-v1 insert policy', () => {
  it('allows authenticated publication inserts only for snapshot_version=1 and Level 4', () => {
    const policyStart = v2Sql.indexOf(
      'CREATE POLICY daily_allocation_publications_insert ON public.daily_allocation_publications'
    );
    expect(policyStart).toBeGreaterThan(-1);
    const nextPolicy = v2Sql.indexOf('\nDROP POLICY IF EXISTS ', policyStart + 1);
    const policySql = nextPolicy === -1 ? v2Sql.slice(policyStart) : v2Sql.slice(policyStart, nextPolicy);
    expect(policySql).toContain('FOR INSERT TO authenticated');
    expect(policySql).toContain('COALESCE(snapshot_version, 1) = 1');
    expect(policySql).toContain("effective_has_module_level('daily-allocation', 4)");
    expect(policySql).not.toContain('SECURITY DEFINER');
  });
});

describe('DA2-CONC-001 lock order', () => {
  it('locks plan then visit resources before cascading delete', () => {
    const deleteFn = functionSql('public.delete_daily_allocation_visit_v2');
    indexOrder(
      deleteFn,
      'private.lock_daily_allocation_plan_day',
      'private.lock_daily_allocation_visit_resources'
    );
    indexOrder(
      deleteFn,
      'private.lock_daily_allocation_visit_resources',
      'DELETE FROM public.daily_allocation_visits'
    );
    indexOrder(deleteFn, 'STALE_ENTITY_VERSION', 'DELETE FROM public.daily_allocation_visits');
    expect(functionSql('private.lock_daily_allocation_visit_resources')).toContain(
      'ARRAY_AGG(labour.profile_id ORDER BY labour.profile_id)'
    );
    expect(functionSql('private.lock_daily_allocation_resource_keys')).toContain('ORDER BY ids');
  });

  it('re-reads the plan after lock so a waited mutation cannot publish a stale version', () => {
    const publishFn = functionSql('public.publish_daily_allocation_plan_v2');
    const lockIdx = publishFn.indexOf('PERFORM private.lock_daily_allocation_plan_day');
    const rereadIdx = publishFn.indexOf(
      'SELECT * INTO plan_day FROM public.daily_allocation_plan_days WHERE id = p_plan_day_id',
      lockIdx
    );
    expect(lockIdx).toBeGreaterThan(-1);
    expect(rereadIdx).toBeGreaterThan(lockIdx);
    indexOrder(
      publishFn,
      'PERFORM private.lock_daily_allocation_plan_day',
      "RAISE EXCEPTION 'STALE_PLAN_VERSION'"
    );
    indexOrder(
      publishFn,
      "RAISE EXCEPTION 'STALE_PLAN_VERSION'",
      'private.bump_daily_allocation_plan_version'
    );
    indexOrder(
      publishFn,
      'PERFORM private.daily_allocation_v2_lock_publish_inputs',
      'CREATE TEMP TABLE pg_temp.da2_snap_visits'
    );
    indexOrder(
      publishFn,
      'CREATE TEMP TABLE pg_temp.da2_snap_visits',
      'private.daily_allocation_v2_plan_fingerprint'
    );
    indexOrder(
      publishFn,
      'private.daily_allocation_v2_assert_labour_assignable',
      'INSERT INTO public.daily_allocation_publications'
    );
    indexOrder(
      publishFn,
      'private.daily_allocation_v2_plan_fingerprint',
      'INSERT INTO public.daily_allocation_publications'
    );

    const lockFn = functionSql('private.daily_allocation_v2_lock_publish_inputs');
    indexOrder(
      publishFn,
      'LOCK TABLE public.profiles IN SHARE MODE',
      'LOCK TABLE public.absences IN SHARE MODE'
    );
    indexOrder(
      publishFn,
      'LOCK TABLE public.absences IN SHARE MODE',
      'LOCK TABLE public.absence_reasons IN SHARE MODE'
    );
    indexOrder(
      publishFn,
      'LOCK TABLE public.absence_reasons IN SHARE MODE',
      'LOCK TABLE public.employee_work_shifts IN SHARE MODE'
    );
    indexOrder(
      publishFn,
      'LOCK TABLE public.employee_work_shifts IN SHARE MODE',
      'LOCK TABLE public.quotes IN SHARE MODE'
    );
    indexOrder(
      publishFn,
      'LOCK TABLE public.quotes IN SHARE MODE',
      'LOCK TABLE public.legacy_quotes IN SHARE MODE'
    );
    indexOrder(
      publishFn,
      'LOCK TABLE public.legacy_quotes IN SHARE MODE',
      'LOCK TABLE public.quote_project_numbers IN SHARE MODE'
    );
    indexOrder(
      publishFn,
      'LOCK TABLE public.quote_project_numbers IN SHARE MODE',
      'FROM public.profiles'
    );
    indexOrder(lockFn, 'private.lock_daily_allocation_resource_keys', 'private.daily_allocation_v2_lock_job_source');
    expect(lockFn).not.toContain('FROM public.profiles');
    expect(lockFn).not.toContain('FROM public.absences');
    expect(lockFn).not.toContain('FROM public.employee_work_shifts');
    expect(publishFn).toContain("SET search_path = ''");
    expect(v2Sql).not.toMatch(/(?<!pg_temp\.)da2_snap_/);
  });

  it('uses plan, resource, then job lock order for visit and plant mutations', () => {
    const upsertFn = functionSql('public.upsert_daily_allocation_visit_v2');
    indexOrder(upsertFn, 'private.lock_daily_allocation_plan_day', 'private.lock_daily_allocation_resource_keys');
    indexOrder(upsertFn, 'private.lock_daily_allocation_resource_keys', 'private.daily_allocation_v2_lock_job_source');

    const deleteFn = functionSql('public.delete_daily_allocation_visit_v2');
    indexOrder(deleteFn, 'private.lock_daily_allocation_visit_resources', 'private.daily_allocation_v2_lock_job_source');

    const assignPlantFn = functionSql('public.assign_daily_allocation_plant_v2');
    indexOrder(assignPlantFn, 'private.lock_daily_allocation_resource_keys', 'private.daily_allocation_v2_lock_job_source');

    const unassignPlantFn = functionSql('public.unassign_daily_allocation_plant_v2');
    indexOrder(unassignPlantFn, 'private.lock_daily_allocation_resource_keys', 'private.daily_allocation_v2_lock_job_source');
    indexOrder(unassignPlantFn, 'private.daily_allocation_v2_lock_job_source', 'DELETE FROM public.daily_allocation_visit_plant');
  });

  it('locks both plans then visit resources on a dedicated cross-plan move RPC', () => {
    const moveFn = functionSql('public.move_daily_allocation_visit_v2');
    expect(moveFn).toContain('p_expected_source_plan_version');
    expect(moveFn).toContain('p_expected_target_plan_version');
    expect(moveFn).toContain("RAISE EXCEPTION 'Use upsert for same-plan visit changes'");
    indexOrder(moveFn, 'first_plan := source_plan', 'private.lock_daily_allocation_plan_day');
    indexOrder(moveFn, 'private.lock_daily_allocation_plan_day', 'private.lock_daily_allocation_visit_resources');
    indexOrder(moveFn, 'private.lock_daily_allocation_visit_resources', 'UPDATE public.daily_allocation_visits');
    expect(v2Sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.move_daily_allocation_visit_v2(UUID, UUID, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role'
    );
  });
});

describe('DA2-PUB-001/002/003 publication contract', () => {
  it('publishes atomically from a locked expected plan version', () => {
    const publishFn = functionSql('public.publish_daily_allocation_plan_v2');
    expect(publishFn).toContain("RAISE EXCEPTION 'CONFIRM_UNALLOCATED_REQUIRED'");
    indexOrder(publishFn, "RAISE EXCEPTION 'CONFIRM_UNALLOCATED_REQUIRED'", 'INSERT INTO public.daily_allocation_publications');
    indexOrder(
      publishFn,
      'INSERT INTO public.daily_allocation_publications',
      'INSERT INTO public.daily_allocation_published_visits'
    );
    indexOrder(
      publishFn,
      'INSERT INTO public.daily_allocation_published_visits',
      'INSERT INTO public.daily_allocation_published_labour'
    );
    indexOrder(
      publishFn,
      'INSERT INTO public.daily_allocation_published_labour',
      'INSERT INTO public.messages'
    );
    expect(publishFn).not.toMatch(/^\s*COMMIT;/m);
  });

  it('serializes idempotent retries after the plan lock', () => {
    const publishFn = functionSql('public.publish_daily_allocation_plan_v2');
    indexOrder(publishFn, 'PERFORM private.lock_daily_allocation_plan_day', 'idempotency_key = p_idempotency_key');
    indexOrder(publishFn, 'idempotency_key = p_idempotency_key', "RAISE EXCEPTION 'STALE_PLAN_VERSION'");
    expect(publishFn).toContain("RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'");
    expect(functionSql('private.prepare_daily_allocation_publication')).toContain(
      'NEW.revision_no := next_revision'
    );
    expect(v2Sql).not.toContain('DROP CONSTRAINT IF EXISTS daily_allocation_publications_idempotency_unique');
  });

  it('snapshots visits in stable chronological order', () => {
    const publishFn = functionSql('public.publish_daily_allocation_plan_v2');
    expect(publishFn).toContain('ORDER BY starts_at, id');
    expect(publishFn).toContain('sequence_no := sequence_no + 1');
    expect(v2Sql).toContain('CONSTRAINT daily_allocation_published_visits_unique_sequence');
  });

  it('fingerprints the complete authoritative plan, not only visit and scope ids', () => {
    const fingerprintFn = functionSql('private.daily_allocation_v2_plan_fingerprint');
    expect(fingerprintFn).toContain('JSONB_BUILD_OBJECT');
    expect(fingerprintFn).toContain("'snapshot_version', 2");
    expect(fingerprintFn).toContain("'plan_day_id', plan_days.id");
    expect(fingerprintFn).toContain("'work_date', plan_days.work_date");
    expect(fingerprintFn).toContain("'revision_no', p_revision_no");
    expect(fingerprintFn).toContain("'idempotency_key', p_idempotency_key");
    expect(fingerprintFn).toContain("'published_by', p_published_by");
    expect(fingerprintFn).toContain("'published_at', p_published_at");
    expect(fingerprintFn).toContain("'scope_team_id', plan_days.team_id");
    expect(fingerprintFn).toContain("'published_plan_version', p_plan_version");
    expect(fingerprintFn).toContain("'confirm_unallocated'");
    expect(fingerprintFn).toContain("'scope_profile_ids'");
    expect(fingerprintFn).toContain('ARRAY_AGG(scope_id ORDER BY scope_id)');
    expect(fingerprintFn).toContain("'source_visit_id', visits.id");
    expect(fingerprintFn).toContain("'sequence_no', visits.sequence_no");
    expect(fingerprintFn).toContain("'customer_name', visits.customer_name");
    expect(fingerprintFn).toContain("'title', visits.title");
    expect(fingerprintFn).toContain("'source_visit_id', labour.visit_id");
    expect(fingerprintFn).toContain("'absence_allocation_behaviour', labour.absence_allocation_behaviour");
    expect(fingerprintFn).toContain("'source_visit_id', plant.visit_id");
    expect(fingerprintFn).toContain("'hired_description', plant.hired_description");
    expect(fingerprintFn).toContain("'conflict_signature', overrides.conflict_signature");
    expect(fingerprintFn).not.toContain('labour.override_id');
    expect(fingerprintFn).not.toContain("'id', overrides.id");
    expect(fingerprintFn.match(/'\[\]'::JSONB/g)?.length).toBe(4);
    expect(fingerprintFn).toContain('FROM pg_temp.da2_snap_visits visits');
    expect(fingerprintFn).toContain('FROM pg_temp.da2_snap_labour labour');

    const persistedFn = functionSql('private.daily_allocation_v2_persisted_fingerprint');
    expect(persistedFn).toContain("'revision_no', publications.revision_no");
    expect(persistedFn).toContain("'idempotency_key', publications.idempotency_key");
    expect(persistedFn).toContain("'published_by', publications.published_by");
    expect(persistedFn).toContain("'published_at', publications.published_at");
    expect(persistedFn).toContain("'source_visit_id', visits.source_visit_id");
    expect(persistedFn).toContain('LEFT JOIN public.daily_allocation_published_visits visits');
    expect(persistedFn).toContain('JOIN public.daily_allocation_published_visits visits');
    expect(persistedFn).toContain("'conflict_signature', overrides.conflict_signature");
    expect(persistedFn).toContain(
      'overrides.conflict_signature, overrides.evidence,\n          overrides.confirmed_by, overrides.confirmed_at'
    );
    expect(persistedFn.match(/'\[\]'::JSONB/g)?.length).toBe(4);

    const publishFn = functionSql('public.publish_daily_allocation_plan_v2');
    expect(publishFn).toContain('private.daily_allocation_v2_plan_fingerprint');
    expect(publishFn).toContain('private.daily_allocation_v2_persisted_fingerprint');
    expect(publishFn).toContain("RAISE EXCEPTION 'SNAPSHOT_FINGERPRINT_MISMATCH'");
    indexOrder(
      publishFn,
      'private.daily_allocation_v2_persisted_fingerprint',
      "RAISE EXCEPTION 'SNAPSHOT_FINGERPRINT_MISMATCH'"
    );
  });
});

describe('DA2-ABS-001 timed absence and shift policy', () => {
  it('rejects overlapping half-day sessions and off-shift intervals without audited overrides', () => {
    const overlapFn = functionSql('private.daily_allocation_overlaps_london_session');
    expect(overlapFn).toContain("TIME '12:00'");
    expect(overlapFn).toContain("p_session = 'AM'");
    expect(overlapFn).toContain("tstzrange(p_starts_at, p_ends_at, '[)')");

    const assignFn = functionSql('public.assign_daily_allocation_labour_v2');
    const assertFn = functionSql('private.daily_allocation_v2_assert_labour_assignable');
    expect(assertFn).toContain("absences.status IN ('approved', 'processed')");
    expect(assertFn).toContain("absence_reasons.allocation_behaviour IN ('block', 'reduce')");
    expect(assertFn).toContain("absences.half_day_session = 'AM'");
    expect(assertFn).toContain("absences.half_day_session = 'PM'");
    expect(assertFn).not.toContain('LIMIT 1');
    expect(assertFn).toContain('private.daily_allocation_overlaps_london_session');
    expect(assertFn).toContain('private.daily_allocation_v2_conflict_signature');
    expect(assertFn).toContain('daily_allocation_v2_has_override');
    expect(assertFn).toContain("'pending_absence'");
    expect(assertFn).toContain("'off_shift'");
    expect(assignFn).toContain('private.daily_allocation_v2_assert_labour_assignable');
    indexOrder(
      assignFn,
      'private.lock_daily_allocation_plan_day',
      'INSERT INTO public.daily_allocation_visit_labour'
    );

    const shiftFn = functionSql('private.daily_allocation_v2_shift_session_working');
    expect(shiftFn).toContain('FROM public.employee_work_shifts');
    expect(shiftFn).toContain('EXTRACT(ISODOW FROM p_work_date)');
    expect(shiftFn).toContain('monday_am');
    expect(shiftFn).toContain('sunday_pm');

    const signatureFn = functionSql('private.daily_allocation_v2_conflict_signature');
    expect(signatureFn).toContain('JSONB_AGG');
    expect(signatureFn).toContain("'updated_at', absences.updated_at");
    expect(signatureFn).toContain('ORDER BY absences.id');
    expect(signatureFn).toContain('SELECT TO_JSONB(shifts)');
    expect(signatureFn).toContain("'session_result'");
    expect(signatureFn).toContain('SET search_path = public, extensions, pg_temp');
    expect(signatureFn).toContain("RETURN ENCODE(DIGEST(CONVERT_TO(conflict_payload::TEXT, 'utf8'), 'sha256'), 'hex')");

    const hashFn = functionSql('private.daily_allocation_v2_hash_snapshot_payload');
    expect(v2Sql).toContain('SET LOCAL search_path = public, extensions, pg_catalog');
    expect(hashFn).toContain('SET search_path = pg_catalog, public, extensions');
    expect(hashFn).toContain("RETURN ENCODE(DIGEST(CONVERT_TO(p_payload::TEXT, 'utf8'), 'sha256'), 'hex')");
  });
});

describe('DA2-NOTIF-001 one message per scoped employee', () => {
  it('creates one publication-linked itinerary or absence message per scoped profile', () => {
    const publishFn = functionSql('public.publish_daily_allocation_plan_v2');
    expect(v2Sql).toContain('CONSTRAINT daily_allocation_publication_notifications_unique');
    expect(v2Sql).toContain('UNIQUE (publication_id, profile_id)');
    expect(publishFn).toContain("created_via,\n      module_key,\n      daily_allocation_publication_id");
    expect(publishFn).toContain("'daily_allocation_publish_v2'");
    expect(publishFn).toContain('INSERT INTO public.daily_allocation_publication_notifications');
    const notificationInsert = publishFn.indexOf(
      'INSERT INTO public.daily_allocation_publication_notifications'
    );
    const visitLoop = publishFn.indexOf('FOR visit_row IN');
    const profileMessageLoop = publishFn.lastIndexOf('WHERE profiles.id = ANY (scope_ids)');
    expect(notificationInsert).toBeGreaterThan(profileMessageLoop);
    expect(profileMessageLoop).toBeGreaterThan(visitLoop);
    expect(publishFn).not.toContain('daily_allocation_labour_item_id');
  });
});

describe('audited conflict-override RPC', () => {
  it('creates overrides server-side and rejects non-overridable resource overlap', () => {
    const overrideFn = functionSql('public.create_daily_allocation_conflict_override_v2');
    expect(overrideFn).toContain('SECURITY DEFINER');
    expect(overrideFn).toContain("p_conflict_kind NOT IN ('pending_absence', 'off_shift')");
    expect(overrideFn).toContain('confirmed_by');
    expect(overrideFn).toContain('actor_id');
    expect(overrideFn).toContain('confirmed_at');
    expect(overrideFn).toContain('NOW()');
    expect(overrideFn).toContain('private.lock_daily_allocation_plan_day');
    expect(overrideFn).toContain('private.lock_daily_allocation_resource_keys');
    expect(overrideFn).toContain("RAISE EXCEPTION 'Conflict override requires a visit'");
    expect(overrideFn).toContain('private.daily_allocation_v2_conflict_signature');
    expect(overrideFn).toContain("RAISE EXCEPTION 'CONFLICT_NOT_PRESENT'");
    expect(overrideFn).toContain('conflict_signature');
    expect(overrideFn).toContain('private.bump_daily_allocation_plan_version');
    expect(overrideFn).not.toContain('resource_overlap');
    expect(v2Sql).toContain("CHECK (conflict_kind IN ('pending_absence', 'off_shift'))");
    expect(v2Sql).toContain('ADD COLUMN IF NOT EXISTS conflict_signature TEXT');
    expect(functionSql('private.daily_allocation_v2_has_override')).toContain(
      'overrides.conflict_signature = p_conflict_signature'
    );
    expect(v2Sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.create_daily_allocation_conflict_override_v2(UUID, INTEGER, TEXT, TEXT, UUID, UUID) TO authenticated, service_role'
    );
    expect(v2Sql).toContain(
      'REVOKE ALL ON FUNCTION public.create_daily_allocation_conflict_override_v2(UUID, INTEGER, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon'
    );
  });
});

describe('assigned labour availability snapshot', () => {
  it('stores resolved absence status instead of hard-coded available', () => {
    const publishFn = functionSql('public.publish_daily_allocation_plan_v2');
    const labourLoop = publishFn.indexOf('FOR labour_row IN');
    const plantLoop = publishFn.indexOf('FOR plant_row IN', labourLoop);
    const assignedSlice = publishFn.slice(labourLoop, plantLoop);
    expect(assignedSlice).not.toMatch(/VALUES\s*\([\s\S]*'available'/);
    expect(assignedSlice).toContain("availability := 'half_day_absence'");
    expect(assignedSlice).toContain('absence_id');
    expect(assignedSlice).toContain('absence_half_day_session');
    expect(assignedSlice).toContain('absence_allocation_behaviour');
  });
});

describe('DA2-ROLL activation artifact', () => {
  it('keeps a controlled idempotent activation script that is not applied by the runner', () => {
    const activation = readFileSync(
      resolve(process.cwd(), 'scripts/supabase/activate-daily-allocation-v2.sql'),
      'utf8'
    ).replace(/\r\n/g, '\n');
    expect(activation).toContain('board_enabled = TRUE');
    expect(activation).toContain('writes_enabled = TRUE');
    expect(activation).toContain('move_daily_allocation_visit_v2');
    expect(activation).toContain('AND (board_enabled IS DISTINCT FROM TRUE OR writes_enabled IS DISTINCT FROM TRUE)');
    expect(runner).toContain('writes_enabled = FALSE');
    expect(runner).not.toContain('activate-daily-allocation-v2.sql');
  });
});
