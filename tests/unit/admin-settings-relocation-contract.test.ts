import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Admin Settings relocation contract', () => {
  it('AUTH-PERM-USERS-01 and AUTH-PERM-MODULE-01 use the level-5 PIN-aware helper', () => {
    const usersRoute = readSource('app/api/admin/permissions/users/route.ts');
    const moduleRoute = readSource('app/api/admin/permissions/modules/[moduleName]/route.ts');

    expect(usersRoute).toContain('requireAdminSettingsAccess');
    expect(usersRoute).toContain('applyPermissionMatrixUpdatesAtomically');
    expect(moduleRoute).toContain('requireAdminSettingsAccess');
    expect(usersRoute).not.toContain('requireAdminUsersModuleAccess');
    expect(moduleRoute).not.toContain('requireAdminUsersModuleAccess');
  });

  it('AUTH-PAYROLL-LEVEL5-01 and AUTH-TIMESHEET-LEVEL5-01 share the same boundary', () => {
    const protectedRoutes = [
      'app/api/admin/settings/payroll-rules/route.ts',
      'app/api/admin/settings/timesheet-exceptions/route.ts',
      'app/api/admin/settings/timesheet-exceptions/[profileId]/route.ts',
    ];

    protectedRoutes.forEach((routePath) => {
      expect(readSource(routePath)).toContain('requireAdminSettingsAccess');
    });
  });

  it('AUTH-ADMINSET-ROLE-01 renders delegated desktop management links', () => {
    const sidebar = readSource('components/layout/SidebarNav.tsx');
    expect(sidebar).toContain('{sidebarManagerLinks.length > 0 && (');
    expect(sidebar).not.toContain('(isManager || isAdmin) && sidebarManagerLinks.length');
    expect(sidebar).toContain('{adminLinks.length > 0 && (');
  });

  it('UI-USERS-MOVED-01 links Permissions from User Management to Admin Settings', () => {
    const usersPage = readSource('app/(dashboard)/admin/users/page.tsx');
    expect(usersPage).toContain('href="/admin/settings?tab=permissions"');
    expect(usersPage).toContain('Permissions');
    expect(usersPage).not.toContain('Permissions moved to Admin Settings');
    expect(usersPage).not.toContain('value="permissions-moved"');
    expect(usersPage).not.toContain('<RoleManagement');
    expect(usersPage).not.toContain('<PermissionsGuide');
  });

  it('UI-PERM-RELOCATE-01 makes Permissions the Admin Settings default', () => {
    const adminSettingsPage = readSource('app/(dashboard)/admin/settings/page.tsx');
    expect(adminSettingsPage).toContain("type AdminSettingsTab = 'permissions' | 'permission-guide' | 'timesheets'");
    expect(adminSettingsPage).toContain(": 'permissions'");
    expect(adminSettingsPage).toContain('<RoleManagement');
    expect(adminSettingsPage).toContain('<PermissionsGuide');
    expect(adminSettingsPage).not.toContain('value="general"');
  });

  it('UI-DISPLAY-RELOCATE-01 owns display controls and instructions in Workshop Tasks', () => {
    const workshopPage = readSource('app/(dashboard)/workshop-tasks/page.tsx');
    const adminSettingsPage = readSource('app/(dashboard)/admin/settings/page.tsx');
    const boardPage = readSource('app/displayboard-workshop/page.tsx');
    const legacyBoardRoute = readSource('app/displayboard-workshop-tv/route.ts');

    expect(workshopPage).toContain('<DisplayBoardSettingsCard');
    expect(adminSettingsPage).not.toContain('<DisplayBoardSettingsCard');
    expect(boardPage).toContain('Workshop Tasks Settings');
    expect(legacyBoardRoute).toContain('Workshop Tasks Settings');
    expect(existsSync(path.join(
      process.cwd(),
      'app/api/admin/settings/display-board/route.ts'
    ))).toBe(false);
  });

  it('HELP-RELOCATE-01 points permissions and display help to their new modules', () => {
    const adminHelp = readSource('scripts/help/faq-catalogue/articles-admin.ts');
    const operationsHelp = readSource('scripts/help/faq-catalogue/articles-ops.ts');
    const seed = readSource('scripts/seed/data/faq-howto.json');

    expect(adminHelp).toContain('Admin Settings → Permissions');
    expect(adminHelp).not.toContain('Open **Admin Settings** and use the display board');
    expect(operationsHelp).toContain('Workshop Tasks → Settings');
    expect(seed).toContain('"category_slug": "workshop-tasks"');
    expect(seed).toContain('"slug": "display-board-settings"');
  });
});
