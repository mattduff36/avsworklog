import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  filterSystemAccounts,
  filterSystemTeams,
  getDisplayedTeamName,
  isSystemAccountProfile,
  isSystemTeam,
  SYSTEM_ACCOUNTS_TEAM_ID,
  SYSTEM_TEAM_DISPLAY_NAME,
} from '@/lib/utils/system-accounts';
import { isHiddenSystemTestAccountProfile } from '@/lib/utils/system-test-accounts';
import { getEffectiveAllowance } from '@/lib/utils/absence-carryover';
import { filterRowsForReportProfileScope, isProfileVisibleInReportScope } from '@/lib/server/report-scope';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('SYSACC-01 system account helper', () => {
  it('hides only the is_system_account flag, not team name or testsuite identity', () => {
    expect(isSystemAccountProfile({ is_system_account: true, team_id: SYSTEM_ACCOUNTS_TEAM_ID })).toBe(true);
    expect(isSystemAccountProfile({ is_system_account: false, team_id: SYSTEM_ACCOUNTS_TEAM_ID })).toBe(false);
    expect(isSystemAccountProfile({ is_system_account: false, team_id: 'plant' })).toBe(false);
    expect(isSystemAccountProfile({ is_system_account: undefined })).toBe(false);
    expect(isHiddenSystemTestAccountProfile({ employee_id: 'TS-ADM', full_name: 'Testsuite Admin' })).toBe(true);
    expect(isSystemAccountProfile({ employee_id: 'TS-ADM', full_name: 'Testsuite Admin' } as { is_system_account?: boolean })).toBe(false);
    expect(isSystemAccountProfile({ is_placeholder: true, full_name: 'Vacant Manager' } as { is_system_account?: boolean })).toBe(false);

    const visible = filterSystemAccounts([
      { id: 'kiosk', is_system_account: true },
      { id: 'normal', is_system_account: false },
      { id: 'placeholder', is_system_account: false, is_placeholder: true },
    ]);
    expect(visible.map((row) => row.id)).toEqual(['normal', 'placeholder']);
  });

  it('identifies the System Accounts team by flag or id, not by display name', () => {
    expect(isSystemTeam({ id: SYSTEM_ACCOUNTS_TEAM_ID, is_system: true })).toBe(true);
    expect(isSystemTeam({ id: 'plant', is_system: false })).toBe(false);
    expect(isSystemTeam({ id: 'plant', is_system: false, name: 'System Accounts' } as { id: string; is_system: boolean })).toBe(false);
    expect(filterSystemTeams([
      { id: 'plant', is_system: false },
      { id: SYSTEM_ACCOUNTS_TEAM_ID, is_system: true },
    ]).map((team) => team.id)).toEqual(['plant']);
    expect(getDisplayedTeamName({ id: SYSTEM_ACCOUNTS_TEAM_ID, name: 'System Accounts' })).toBe(SYSTEM_TEAM_DISPLAY_NAME);
    expect(getDisplayedTeamName({ id: 'plant', is_system: false, name: 'Plant' })).toBe('Plant');
  });
});

describe('SYSACC-02 absence and bank-holiday eligibility', () => {
  it('does not coalesce an explicit 0 allowance back to 28', () => {
    expect(getEffectiveAllowance(0)).toBe(0);
    expect(getEffectiveAllowance(null)).toBe(28);
    expect(getEffectiveAllowance(undefined)).toBe(28);
  });

  it('omits system accounts from bank-holiday, bulk, carryover, and leave reports', () => {
    const bankHoliday = readSource('lib/services/absence-bank-holiday-sync.ts');
    expect(bankHoliday).toContain("eq('is_system_account', false)");
    expect(bankHoliday).toContain('filter((profile) => !isSystemAccountProfile(profile))');
    expect(bankHoliday).toContain('annual_holiday_allowance_days ?? 28');

    const allowanceTotals = readSource('app/api/reports/absence-leave/allowance-totals/route.ts');
    expect(allowanceTotals).toContain('filterSystemAccounts');
    expect(allowanceTotals).toContain("eq('is_system_account', false)");

    const bookings = readSource('app/api/reports/absence-leave/bookings/route.ts');
    expect(bookings).toContain('getSystemAccountIds');
    expect(bookings).toContain('isSystemAccountProfile');

    const weeklyPrint = readSource('lib/server/absence-weekly-print-report.ts');
    expect(weeklyPrint).toContain('getSystemAccountIds');
    expect(weeklyPrint).toContain('isSystemAccountProfile');
  });
});

describe('SYSACC-03 permissions matrix includes kiosk and hides testsuite', () => {
  it('keeps system accounts on the matrix while omitting them from operational module pickers', () => {
    const source = readSource('lib/server/team-permissions.ts');
    const matrixFn = source.slice(
      source.indexOf('export async function getUserPermissionMatrix'),
      source.indexOf('export async function updateTeamModulePermissions')
    );
    const moduleAccessFn = source.slice(source.indexOf('export async function getUsersWithModuleAccess'));

    expect(matrixFn).toContain('is_system_account');
    expect(matrixFn).toContain('isHiddenSystemTestAccountProfile');
    expect(matrixFn).not.toContain('filterSystemAccounts');
    expect(matrixFn).not.toContain('!isSystemAccountProfile(profile)');
    expect(matrixFn).toContain('is_system_account: isSystemAccountProfile(profile)');

    expect(moduleAccessFn).toContain('!isSystemAccountProfile(profile)');
  });
});

describe('SYSACC-04 directory payroll allocation omit system accounts', () => {
  it('filters system accounts from operational people lists even when Inventory access is 1', () => {
    const directory = readSource('app/api/users/directory/route.ts');
    expect(directory).toContain("eq('is_system_account', false)");
    expect(directory).toContain('filterOperationalProfiles');

    const payroll = readSource('lib/server/payroll-admin.ts');
    expect(payroll).toContain("eq('is_system_account', false)");
    expect(payroll).toContain('filterSystemAccounts');
    expect(payroll).toContain('filterSystemTeams');

    const allocationAuth = readSource('lib/server/daily-allocation/auth.ts');
    expect(allocationAuth).toContain("eq('is_system_account', false)");
    expect(allocationAuth).toContain('!isSystemAccountProfile(row)');

    const allocationBoard = readSource('lib/server/daily-allocation/board.ts');
    expect(allocationBoard).toContain('!isSystemAccountProfile(profile)');
    expect(allocationBoard).toContain('filterSystemTeams');
  });
});

describe('SYSACC-05 migration contract', () => {
  it('seeds System Accounts, snapshots then deletes kiosk bank holidays, and identifies the kiosk only via config', () => {
    const sql = readSource('supabase/migrations/20260819170000_system_accounts.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS is_system_account BOOLEAN NOT NULL DEFAULT FALSE');
    expect(sql).toContain("id = 'system_accounts'");
    expect(sql).toContain("'System Accounts'");
    expect(sql).toContain('is_system = TRUE');
    expect(sql).toContain('FROM public.inventory_kiosk_config');
    expect(sql).not.toContain('yard-kiosk@squiresapp.com');
    expect(sql).toContain('private.system_account_absence_snapshots');
    expect(sql.indexOf('INTO v_team_before')).toBeLessThan(sql.indexOf('INSERT INTO public.org_teams'));
    expect(sql.indexOf('INSERT INTO private.system_account_migration_snapshots')).toBeLessThan(
      sql.indexOf('INSERT INTO public.org_teams')
    );
    expect(sql.indexOf('INSERT INTO private.system_account_absence_snapshots')).toBeLessThan(
      sql.indexOf('DELETE FROM public.absences')
    );
    expect(sql).toContain('ON CONFLICT (snapshot_key) DO NOTHING');
    expect(sql).toContain('annual_holiday_allowance_days = 0');
    expect(sql).toContain('enabled = FALSE');
    expect(sql).toContain('COALESCE(profiles.is_system_account, FALSE) = FALSE');
    expect(sql).toContain('app.system_account_maintenance');
    expect(sql).toContain('app.absence_historic_delete_bypass');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('protect_system_account_identity');
    expect(sql).toContain('protect_system_team_permissions');
    expect(sql).toContain('OLD.team_id');
    expect(sql).toContain('System Accounts team defaults cannot be moved');
    expect(sql).toContain('COALESCE(NEW.snapshot_version, 1) <> 2');
    expect(sql).toContain('is_bank_holiday IS TRUE');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('Configured kiosk has leave carryover');
  });
});

describe('SYSACC-ID-01 kiosk identity', () => {
  it('SYSACC-ID-01 targets only the configured kiosk_user_id with no email fallback', () => {
    const sql = readSource('supabase/migrations/20260819170000_system_accounts.sql');
    expect(sql).toContain('FROM public.inventory_kiosk_config');
    expect(sql).toContain('kiosk_user_id');
    expect(sql).not.toContain('yard-kiosk@squiresapp.com');
    expect(sql).not.toContain('Yard Kiosk');
    expect(sql.toLowerCase()).not.toContain("full_name ilike");
  });
});

describe('SYSACC-SNAPSHOT-01 rollback snapshot', () => {
  it('SYSACC-SNAPSHOT-01 captures team, profile, and absence rows before those mutations', () => {
    const sql = readSource('supabase/migrations/20260819170000_system_accounts.sql');
    expect(sql.indexOf('INTO v_team_before')).toBeLessThan(sql.indexOf('INSERT INTO public.org_teams'));
    expect(sql.indexOf('INTO v_profile_before')).toBeLessThan(sql.indexOf('UPDATE public.profiles'));
    expect(sql.indexOf('INSERT INTO private.system_account_absence_snapshots')).toBeLessThan(
      sql.indexOf('DELETE FROM public.absences')
    );
    const reviewFixes = readSource('supabase/migrations/20260819180000_system_accounts_review_fixes.sql');
    expect(reviewFixes).toContain("snapshot_key = 'yard-kiosk-system-accounts-v1'");
    expect(reviewFixes).toContain('team_before = NULL');
  });
});

describe('SYSACC-SCOPE-01 absence delete scope', () => {
  it('SYSACC-SCOPE-01 deletes only the configured profile bank-holiday rows after snapshot IDs', () => {
    const sql = readSource('supabase/migrations/20260819170000_system_accounts.sql');
    expect(sql).toContain('AND absences.is_bank_holiday IS TRUE');
    expect(sql).toContain('AND absences_archive.is_bank_holiday IS TRUE');
    expect(sql).toContain('WHERE id IN (');
    expect(sql).toContain('FROM private.system_account_absence_snapshots');
    expect(sql).not.toContain('DELETE FROM public.absences\n  WHERE profile_id');
  });
});

describe('SYSACC-RLS-01 mutation guards', () => {
  it('SYSACC-RLS-01 blocks ordinary identity, team, and team-default writes', () => {
    const sql = readSource('supabase/migrations/20260819170000_system_accounts.sql');
    expect(sql).toContain('System accounts cannot be deleted');
    expect(sql).toContain('System account identity cannot be changed');
    expect(sql).toContain('System Accounts team cannot be deleted');
    expect(sql).toContain('OLD.team_id');
    expect(sql).toContain('System Accounts team defaults cannot be moved');
    const adminUsers = readSource('app/api/admin/users/[id]/route.ts');
    expect(adminUsers).toContain('System accounts cannot be edited from Admin Users');
    expect(adminUsers).toContain('System accounts cannot be deleted');
  });
});

describe('SYSACC-PERM-01 team defaults and inventory', () => {
  it('SYSACC-PERM-01 keeps team defaults disabled and Inventory at exactly level 1', () => {
    const sql = readSource('supabase/migrations/20260819170000_system_accounts.sql');
    expect(sql).toContain('enabled = FALSE');
    const configure = readSource('scripts/configure-inventory-yard-kiosk.ts');
    expect(configure).toContain('const inventoryAccessLevel = 1');
    expect(configure).toContain('inventory_access_level !== 1');
    const mutations = readSource('lib/server/permission-matrix-mutations.ts');
    expect(mutations).toContain('System Accounts team defaults cannot be changed');
  });
});

describe('SYSACC-ADMIN-01 admin surfaces', () => {
  it('SYSACC-ADMIN-01 shows muted System Accounts and rejects admin mutation bypasses', () => {
    const matrix = readSource('components/admin/RoleManagement.tsx');
    expect(matrix).toContain('group.isSystem');
    expect(matrix).toContain('if (team.is_system) return');
    const teamsTab = readSource('components/admin/TeamsTab.tsx');
    expect(teamsTab).toContain('disabled={!canMutateTeams || isSystemTeam}');
    const teamsApi = readSource('app/api/admin/hierarchy/teams/[id]/route.ts');
    expect(teamsApi).toContain('System Accounts team cannot be changed');
    expect(teamsApi).toContain('System Accounts team cannot be deleted');
  });
});

describe('SYSACC-HIDE-01 operational hide', () => {
  it('SYSACC-HIDE-01 filters operational people lists by is_system_account only', () => {
    const helper = readSource('lib/utils/system-accounts.ts');
    expect(helper).toContain('return candidate.is_system_account === true');
    expect(helper).not.toContain('candidate.email');
    const directory = readSource('app/api/users/directory/route.ts');
    expect(directory).toContain("eq('is_system_account', false)");
    const payroll = readSource('lib/server/payroll-admin.ts');
    expect(payroll).toContain('filterSystemAccounts');
  });
});

describe('SYSACC-DA-01 daily allocation', () => {
  it('SYSACC-DA-01 excludes system accounts from list, publication, and labour assignment', () => {
    const sql = readSource('supabase/migrations/20260819170000_system_accounts.sql');
    expect(sql).toContain('private.filter_daily_allocation_scope_ids');
    expect(sql).toContain('reject_system_account_labour_allocation');
    expect(sql).toContain('COALESCE(profiles.is_system_account, FALSE) = FALSE');
    const auth = readSource('lib/server/daily-allocation/auth.ts');
    expect(auth).toContain('!isSystemAccountProfile(row)');
  });
});

describe('SYSACC-YEAR-01 year close', () => {
  it('SYSACC-YEAR-01 skips system profiles in the live year-close function', () => {
    const sql = readSource('supabase/migrations/20260819170000_system_accounts.sql');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.close_absence_financial_year_bookings');
    expect(sql).toContain('AND COALESCE(p.is_system_account, FALSE) = FALSE');
    expect(sql).toContain('snapshot_financial_year_carryovers_before_close');
  });
});

describe('SYSACC-TYPES-01 generated types', () => {
  it('SYSACC-TYPES-01 includes the new profile and team flags', () => {
    const database = readSource('types/database.ts');
    expect(database).toContain('is_system_account: boolean');
    expect(database).toContain('is_system: boolean');
    const roles = readSource('types/roles.ts');
    expect(roles).toContain('is_system_account: boolean');
  });
});

describe('SYSACC-NONREG-01 kiosk pairing unchanged', () => {
  it('SYSACC-NONREG-01 leaves pairing, trusted-device, and transfer RPC files untouched by hide logic', () => {
    const pairing = readSource('lib/server/inventory-kiosk-devices.ts');
    expect(pairing).not.toContain('is_system_account');
    expect(pairing).not.toContain('system-accounts');
    const configure = readSource('scripts/configure-inventory-yard-kiosk.ts');
    expect(configure).not.toContain('inventory_kiosk_devices');
    expect(configure).not.toContain('inventory_kiosk_execute_transfer');
  });
});

describe('SYSACC-06 muted admin UI keeps system accounts visible', () => {
  it('mutes System Accounts on the matrix, Admin Users, and Teams without hiding the kiosk row', () => {
    const matrix = readSource('components/admin/RoleManagement.tsx');
    expect(matrix).toContain('group.isSystem');
    expect(matrix).toContain('user.is_system_account');
    expect(matrix).toContain('if (team.is_system) return');
    expect(matrix).toContain('getDisplayedTeamName');
    expect(matrix).toContain('System');
    expect(matrix).not.toContain('normal-case italic leading-none text-slate-500');
    expect(matrix).not.toContain('filterSystemAccounts(');

    const adminUsers = readSource('app/(dashboard)/admin/users/page.tsx');
    expect(adminUsers).toContain('isSystemAccountProfile');
    expect(adminUsers).toContain('getDisplayedTeamName');
    expect(adminUsers).toContain('System');
    expect(adminUsers).not.toContain('filterSystemAccounts(');
    expect(adminUsers).toContain('createUserTeamOptions');

    const teamsTab = readSource('components/admin/TeamsTab.tsx');
    expect(teamsTab).toContain('isSystemTeam');
    expect(teamsTab).toContain('getDisplayedTeamName');
    expect(teamsTab).toContain('disabled={!canMutateTeams || isSystemTeam}');
  });
});

describe('SYSACC-07 configure-kiosk script', () => {
  it('writes team, system flag, zero allowance, and Inventory level 1', () => {
    const source = readSource('scripts/configure-inventory-yard-kiosk.ts');
    expect(source).toContain("team_id = 'system_accounts'");
    expect(source).toContain('is_system_account = TRUE');
    expect(source).toContain('annual_holiday_allowance_days = 0');
    expect(source).toContain('const inventoryAccessLevel = 1');
    expect(source).toContain("app.system_account_maintenance");
    expect(source).toContain('inventory_access_level !== 1');
    expect(source).not.toContain('minimum_role.hierarchy_rank');
  });
});

describe('SYSACC-R1 remaining operational pickers', () => {
  it('SYSACC-R1 omits system accounts from remaining report, scope, and settings lists', () => {
    const stats = readSource('app/api/reports/stats/route.ts');
    expect(stats).toContain("eq('is_system_account', false)");
    expect(stats).toContain('isProfileVisibleInReportScope');

    const timesheetScope = readSource('lib/server/reports-timesheet-scope.ts');
    expect(timesheetScope).toContain('filterRowsForReportProfileScope');
    expect(timesheetScope).toContain('getSystemAccountIds');

    const reportScope = readSource('lib/server/report-scope.ts');
    expect(reportScope).toContain("eq('is_system_account', false)");

    const timesheetExceptions = readSource('lib/server/timesheet-type-exceptions.ts');
    expect(timesheetExceptions).toContain("eq('is_system_account', false)");
    expect(timesheetExceptions).toContain('isSystemAccountProfile(profile)');

    const processedAbsence = readSource('lib/server/processed-absence-notifications.ts');
    expect(processedAbsence).toContain("eq('is_system_account', false)");
    const processedAbsenceTests = readSource('tests/unit/processed-absence-notifications.test.ts');
    expect(processedAbsenceTests).toContain("toHaveBeenCalledWith('is_system_account', false)");

    const operationalListSources = [
      'app/api/users/directory/route.ts',
      'app/api/permissions/users/route.ts',
      'app/api/reports/absence-leave/allowance-totals/route.ts',
      'app/api/reports/absence-leave/bookings/route.ts',
      'lib/server/absence-weekly-print-report.ts',
      'lib/services/absence-bank-holiday-sync.ts',
      'lib/server/payroll-admin.ts',
      'lib/server/daily-allocation/auth.ts',
      'lib/server/daily-allocation/board.ts',
      'app/api/messages/route.ts',
      'app/api/quotes/metadata/route.ts',
      'app/api/notification-preferences/admin/route.ts',
      'app/api/timesheets/managers/route.ts',
      'app/api/superadmin/active-users/route.ts',
      'lib/server/team-permissions.ts',
    ];
    for (const relativePath of operationalListSources) {
      const source = readSource(relativePath);
      expect(
        source.includes("eq('is_system_account', false)")
        || source.includes('filterSystemAccounts')
        || source.includes('filterOperationalProfiles')
        || source.includes('getSystemAccountIds')
        || source.includes('!isSystemAccountProfile')
      ).toBe(true);
    }
  });
});

describe('SYSACC-R1-REPORT-UNSCOPED-01 unrestricted report hide', () => {
  it('SYSACC-R1-REPORT-UNSCOPED-01 drops system accounts when report scope is unrestricted', () => {
    const hiddenProfileIds = new Set(['kiosk']);
    expect(isProfileVisibleInReportScope('kiosk', null, hiddenProfileIds)).toBe(false);
    expect(isProfileVisibleInReportScope('employee', null, hiddenProfileIds)).toBe(true);
    expect(isProfileVisibleInReportScope('employee', new Set(['employee']), hiddenProfileIds)).toBe(true);
    expect(isProfileVisibleInReportScope('kiosk', new Set(['kiosk', 'employee']), hiddenProfileIds)).toBe(false);

    const rows = filterRowsForReportProfileScope(
      [{ user_id: 'kiosk' }, { user_id: 'employee' }],
      null,
      hiddenProfileIds,
      (row) => row.user_id
    );
    expect(rows.map((row) => row.user_id)).toEqual(['employee']);
  });
});

describe('SYSACC-R2 live allowance SQL', () => {
  it('SYSACC-R2 excludes system accounts from carryover COALESCE-to-28', () => {
    const sql = readSource('supabase/migrations/20260819190000_system_accounts_allowance_exclusions.sql');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.recalculate_financial_year_carryover_for_profile');
    expect(sql).toContain('WHEN COALESCE(is_system_account, FALSE) THEN COALESCE(annual_holiday_allowance_days, 0)');
    expect(sql).toContain('ELSE COALESCE(annual_holiday_allowance_days, 28)');
    expect(sql).toContain('IF v_is_system_account THEN');
    expect(sql.indexOf('IF v_is_system_account THEN')).toBeLessThan(
      sql.indexOf('IF v_base_allowance IS NULL THEN')
    );

    const yearClose = readSource('supabase/migrations/20260819170000_system_accounts.sql');
    expect(yearClose).toContain('AND COALESCE(p.is_system_account, FALSE) = FALSE');

    const bankHoliday = readSource('lib/services/absence-bank-holiday-sync.ts');
    expect(bankHoliday).toContain("eq('is_system_account', false)");
    expect(getEffectiveAllowance(0)).toBe(0);
    expect(getEffectiveAllowance(null)).toBe(28);
  });
});
