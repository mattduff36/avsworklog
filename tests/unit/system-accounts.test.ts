import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  filterSystemAccounts,
  filterSystemTeams,
  isSystemAccountProfile,
  isSystemTeam,
  SYSTEM_ACCOUNTS_TEAM_ID,
} from '@/lib/utils/system-accounts';
import { isHiddenSystemTestAccountProfile } from '@/lib/utils/system-test-accounts';
import { getEffectiveAllowance } from '@/lib/utils/absence-carryover';

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
    expect(sql).toContain('COALESCE(NEW.snapshot_version, 1) <> 2');
    expect(sql).toContain('is_bank_holiday IS TRUE');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('Configured kiosk has leave carryover');
  });
});

describe('SYSACC-06 muted admin UI keeps system accounts visible', () => {
  it('mutes System Accounts on the matrix, Admin Users, and Teams without hiding the kiosk row', () => {
    const matrix = readSource('components/admin/RoleManagement.tsx');
    expect(matrix).toContain('group.isSystem');
    expect(matrix).toContain('user.is_system_account');
    expect(matrix).toContain('if (team.is_system) return');
    expect(matrix).toContain('System');
    expect(matrix).not.toContain('filterSystemAccounts(');

    const adminUsers = readSource('app/(dashboard)/admin/users/page.tsx');
    expect(adminUsers).toContain('isSystemAccountProfile');
    expect(adminUsers).toContain('System');
    expect(adminUsers).not.toContain('filterSystemAccounts(');
    expect(adminUsers).toContain('createUserTeamOptions');

    const teamsTab = readSource('components/admin/TeamsTab.tsx');
    expect(teamsTab).toContain('isSystemTeam');
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
