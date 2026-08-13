import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260813_daily_allocation_module.sql'),
  'utf8'
);
const enforcementSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260813_zz_daily_allocation_enforcement.sql'),
  'utf8'
);
const splitGuardSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260813_y_daily_allocation_split_draft_guards.sql'),
  'utf8'
);
const rollbackSql = readFileSync(
  resolve(process.cwd(), 'supabase/rollback/20260813_disable_daily_allocation.sql'),
  'utf8'
);
const permissionLockdownSql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260813102922_daily_allocation_admin_only_permissions.sql'
  ),
  'utf8'
).replace(/\r\n/g, '\n');

describe('daily allocation migration contract', () => {
  it('PUB-001 validates all-or-nothing publish incompleteness', () => {
    expect(sql).toContain("RAISE EXCEPTION 'PUBLISH_INCOMPLETE'");
    expect(sql).toContain('availability IN (\'available\', \'half_day_absence\')');
  });

  it('PUB-002 serializes revisions and retries by idempotency key', () => {
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('daily_allocation_publications_revision_unique');
    expect(sql).toContain('daily_allocation_publications_idempotency_unique');
  });

  it('PUB-003 snapshots labour/plant and blocks mutation', () => {
    expect(sql).toContain('Published daily allocation records cannot be changed');
    expect(sql).toContain('INSERT INTO public.daily_allocation_labour_items');
    expect(sql).toContain('INSERT INTO public.daily_allocation_plant_items');
  });

  it('NOTIF-001 creates one linked low-priority message per labour item', () => {
    expect(sql).toContain("priority,");
    expect(sql).toContain("'LOW'");
    expect(sql).toContain('daily_allocation_labour_item_id');
    expect(sql).toContain('messages_daily_allocation_labour_item_uniq');
    expect(sql).toContain('INSERT INTO public.message_recipients (message_id, user_id, status)');
    expect(sql).toContain('guard_daily_allocation_recipient_mutation');
    expect(sql).toContain('NEW.sender_id IS DISTINCT FROM OLD.sender_id');
    expect(sql).toContain('Published allocation message recipients cannot be redirected');
  });

  it('DRAFT-001 enforces labour/plant uniqueness and stale versions', () => {
    expect(sql).toContain('daily_labour_allocation_drafts_unique_profile_date');
    expect(sql).toContain('daily_plant_allocation_drafts_registered_uniq');
    expect(sql).toContain("RAISE EXCEPTION 'STALE_DRAFT_VERSION'");
    expect(sql).toContain('(work_date, hired_serial_normalized, hired_company_normalized)');
    expect(splitGuardSql).toContain('guard_daily_labour_allocation_draft_write');
    expect(splitGuardSql).toContain('guard_daily_plant_allocation_draft_write');
    expect(splitGuardSql).toContain('DROP FUNCTION IF EXISTS private.guard_daily_allocation_draft_write()');
  });

  it('AUTH helpers use current team and current reporting lines only', () => {
    expect(sql).toContain('actor_team_id TEXT');
    expect(sql).toContain('target_team_id TEXT');
    expect(sql).toContain('owner_team_id TEXT');
    expect(sql).toContain('scope_team_id TEXT');
    expect(sql).toContain('lines.valid_from <= NOW()');
    expect(sql).toContain('lines.valid_to IS NULL');
    expect(sql).toContain("view_as_role_id() IS NOT NULL");
    expect(sql).toContain('can_actor_manage_daily_allocation');
    expect(sql).toContain('list_daily_allocation_plant_conflicts');
    expect(sql).not.toContain('owner_team_id IS DISTINCT FROM (SELECT team_id FROM public.profiles WHERE id = auth.uid())');
    expect(sql).toContain('Not allowed to change this labour allocation');
    expect(sql).not.toContain('public.can_actor_manage_daily_allocation(items.profile_id)\n    )\n  );\n\nCREATE OR REPLACE FUNCTION public.list_daily_allocation_plant_conflicts');
    expect(sql.indexOf('CREATE OR REPLACE FUNCTION private.is_hidden_daily_allocation_profile'))
      .toBeLessThan(sql.indexOf('CREATE OR REPLACE FUNCTION public.list_daily_allocation_scope_profile_ids'));
  });

  it('PLANT-001 phases job enforcement after the compatible deployment', () => {
    expect(
      '20260813_daily_allocation_module.sql'.localeCompare('20260813_zz_daily_allocation_enforcement.sql')
    ).toBeLessThan(0);
    expect(
      '20260813_y_daily_allocation_split_draft_guards.sql'
        .localeCompare('20260813_zz_daily_allocation_enforcement.sql')
    ).toBeLessThan(0);
    expect(sql).toContain('-- finalise-phase: predeploy');
    expect(sql).toContain('plant_inspections_job_guard');
    expect(sql).not.toContain("RAISE EXCEPTION 'JOB_REQUIRED'");
    expect(enforcementSql).toContain('-- finalise-phase: postdeploy');
    expect(enforcementSql).toContain("RAISE EXCEPTION 'JOB_REQUIRED'");
    expect(enforcementSql).toContain("AND OLD.status = 'submitted'");
    expect(sql).toContain('allocation_quote_is_catalogue_eligible');
    expect(sql).toContain('is_hidden_daily_allocation_profile');
    expect(sql).toContain('customers.company_name::TEXT');
    expect(sql).toContain('FOR v_lookup_code IN');
    expect(sql).toContain('aliases.alias_reference::TEXT');
  });

  it('ROLL-001 defers module activation and preserves rollback history', () => {
    expect(sql).not.toContain("INSERT INTO public.permission_modules (module_name, minimum_role_id, sort_order, access_mode)");
    expect(enforcementSql).toContain("INSERT INTO public.permission_modules (module_name, minimum_role_id, sort_order, access_mode)");
    expect(enforcementSql).toContain("'daily-allocation'");
    expect(enforcementSql).toContain("SELECT org_teams.id, 'daily-allocation', TRUE");
    expect(rollbackSql).toContain("WHERE module_name = 'daily-allocation'");
    expect(rollbackSql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('DROP TABLE public.daily_allocation_publications');
    const runner = readFileSync(
      resolve(process.cwd(), 'scripts/run-daily-allocation-module-migration.ts'),
      'utf8'
    );
    expect(runner).toContain('POSTGRES_URL_NON_POOLING');
    expect(runner).not.toContain('POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL');
    expect(runner).toContain('requireSafeMigrationConnectionString');
    expect(runner).toContain('module_state_valid');
    expect(runner).toContain('FINALISE_MIGRATION_LEDGER_SQL');
    expect(runner).toContain('decideFinaliseMigrationLedgerAction');
    expect(runner).not.toContain('/pooler/i');
    const enforcementRunner = readFileSync(
      resolve(process.cwd(), 'scripts/enforce-daily-allocation-postdeploy.ts'),
      'utf8'
    );
    expect(enforcementRunner).toContain('20260813_zz_daily_allocation_enforcement.sql');
    expect(enforcementRunner).toContain('enabled_teams');
    expect(enforcementRunner).toContain('module_exists');
    expect(enforcementRunner).not.toContain('rows[0].enabled_teams < 1');
    expect(enforcementRunner).toContain('FINALISE_MIGRATION_LEDGER_SQL');
    expect(enforcementRunner).toContain('decideFinaliseMigrationLedgerAction');
  });

  it('PERM-DA-01 locks initial module permissions to admins without hiding the matrix column', () => {
    expect(permissionLockdownSql).toContain('-- finalise-phase: predeploy');
    expect(permissionLockdownSql).toContain('daily_allocation_permission_lockdown_snapshots');
    expect(permissionLockdownSql).toContain('REVOKE ALL ON TABLE');
    expect(permissionLockdownSql).toContain("'20260813102922_admin_only_permissions'");
    expect(permissionLockdownSql).toContain("WHERE roles.name = 'employee'");
    expect(permissionLockdownSql).toContain('AND roles.hierarchy_rank = 2');
    expect(permissionLockdownSql).toContain("SELECT\n  'daily-allocation',");
    expect(permissionLockdownSql).toContain('SET enabled = FALSE');
    expect(permissionLockdownSql).toContain('SET access_level = 0');
    expect(permissionLockdownSql).toContain('public.user_module_access_level(');
    expect(permissionLockdownSql).toContain("<> 0");
    expect(permissionLockdownSql).toContain("<> 5");
    expect(permissionLockdownSql).not.toContain('DELETE FROM public.permission_modules');

    const lockdownRunner = readFileSync(
      resolve(process.cwd(), 'scripts/run-daily-allocation-permission-lockdown.ts'),
      'utf8'
    );
    expect(lockdownRunner).toContain('POSTGRES_URL_NON_POOLING');
    expect(lockdownRunner).toContain('requireSafeMigrationConnectionString');
    expect(lockdownRunner).toContain('FINALISE_MIGRATION_LEDGER_SQL');
    expect(lockdownRunner).toContain('effective_non_admins');
    expect(lockdownRunner).toContain('effective_level_five_admins');
    expect(lockdownRunner).toContain('snapshot_exists');
  });

  it('PERM-DA-04 verifies effective live access, not only stored permission rows', () => {
    const lockdownRunner = readFileSync(
      resolve(process.cwd(), 'scripts/run-daily-allocation-permission-lockdown.ts'),
      'utf8'
    );
    expect(lockdownRunner).toContain('public.user_module_access_level(');
    expect(lockdownRunner).toContain('result.effective_non_admins !== 0');
    expect(lockdownRunner).toContain(
      'result.effective_level_five_admins !== result.admin_profiles'
    );
  });

  it('PERM-DA-06 keeps the applied activation immutable and its runner policy-neutral', () => {
    expect(createHash('sha256').update(enforcementSql, 'utf8').digest('hex')).toBe(
      '5e2496d5d8fbd67f2ee196ffa65c608ca17779671662cef06ed298c7cb6ea094'
    );
    const enforcementRunner = readFileSync(
      resolve(process.cwd(), 'scripts/enforce-daily-allocation-postdeploy.ts'),
      'utf8'
    );
    expect(enforcementRunner).toContain('module_exists');
    expect(enforcementRunner).not.toContain('rows[0].enabled_teams < 1');
  });

  it('PERM-DA-07 captures an exact private before-image before permission mutation', () => {
    const snapshotInsert = permissionLockdownSql.indexOf(
      'INSERT INTO private.daily_allocation_permission_lockdown_snapshots'
    );
    const teamMutation = permissionLockdownSql.indexOf(
      'INSERT INTO public.team_module_permissions'
    );
    const userMutation = permissionLockdownSql.indexOf(
      'UPDATE public.user_module_permissions'
    );

    expect(snapshotInsert).toBeGreaterThan(-1);
    expect(snapshotInsert).toBeLessThan(teamMutation);
    expect(snapshotInsert).toBeLessThan(userMutation);
    expect(permissionLockdownSql).toContain('TO_JSONB(permission_modules)');
    expect(permissionLockdownSql).toContain('TO_JSONB(team_module_permissions)');
    expect(permissionLockdownSql).toContain('TO_JSONB(user_module_permissions)');
    expect(permissionLockdownSql).toContain('TO_JSONB(role_permissions)');
  });
});
