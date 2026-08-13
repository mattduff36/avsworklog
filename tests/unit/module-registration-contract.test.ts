import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import permissionsAudit from '@/lib/config/permissions-secondary-audit.json';
import { FORM_TYPES } from '@/lib/config/forms';
import { MODULE_PAGES } from '@/lib/config/module-pages';
import {
  canAccessNavItem,
  employeeNavItems,
  managerNavItems,
} from '@/lib/config/navigation';
import {
  getReleaseDescriptorByScope,
  getReleaseDescriptorMatches,
} from '@/lib/config/release-module-descriptors';
import {
  ALL_MODULES,
  MANAGEMENT_MODULES,
  MODULE_CSS_VAR,
  MODULE_DESCRIPTIONS,
  MODULE_DISPLAY_NAMES,
  MODULE_SHORT_NAMES,
  STANDARD_MODULES,
} from '@/types/roles';

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

describe('permissioned module registration contract', () => {
  it('PERM-REG-01 aligns canonical modules with metadata, categories, and the permission guide', () => {
    const canonicalModules = sorted(ALL_MODULES);
    const categoryModules = [...STANDARD_MODULES, ...MANAGEMENT_MODULES];
    const auditModules = permissionsAudit.modules.map((module) => module.moduleName);

    expect(new Set(ALL_MODULES).size).toBe(ALL_MODULES.length);
    expect(new Set(categoryModules).size).toBe(categoryModules.length);
    expect(sorted(categoryModules)).toEqual(canonicalModules);
    expect(sorted(Object.keys(MODULE_DISPLAY_NAMES))).toEqual(canonicalModules);
    expect(sorted(Object.keys(MODULE_SHORT_NAMES))).toEqual(canonicalModules);
    expect(sorted(Object.keys(MODULE_DESCRIPTIONS))).toEqual(canonicalModules);
    expect(sorted(Object.keys(MODULE_CSS_VAR))).toEqual(canonicalModules);
    expect(sorted(auditModules)).toEqual(canonicalModules);
  });

  it('PERM-NAV-01 registers Daily Allocation Level 2 self and Level 4 management surfaces', () => {
    const selfItem = employeeNavItems.find((item) => item.href === '/daily-allocation/my');
    const managerItem = managerNavItems.find((item) => item.href === '/daily-allocation');
    const timesheetsItem = employeeNavItems.find((item) => item.href === '/timesheets');
    const enabledModules = new Set(ALL_MODULES);
    const dropdownItem = {
      href: '#daily-allocation',
      label: 'Allocation',
      icon: managerItem!.icon,
      dropdownItems: [managerItem!],
    };

    expect(selfItem?.minimumAccessLevel).toBe(2);
    expect(managerItem?.minimumAccessLevel).toBe(4);
    expect(canAccessNavItem(selfItem!, enabledModules, { 'daily-allocation': 0 }, false)).toBe(false);
    expect(canAccessNavItem(selfItem!, enabledModules, { 'daily-allocation': 2 }, false)).toBe(true);
    expect(canAccessNavItem(managerItem!, enabledModules, { 'daily-allocation': 2 }, false)).toBe(false);
    expect(canAccessNavItem(managerItem!, enabledModules, { 'daily-allocation': 4 }, false)).toBe(true);
    expect(canAccessNavItem(managerItem!, enabledModules, null, false)).toBe(false);
    expect(canAccessNavItem(timesheetsItem!, enabledModules, null, false)).toBe(true);
    expect(canAccessNavItem(dropdownItem, enabledModules, { 'daily-allocation': 2 }, false)).toBe(false);
    expect(canAccessNavItem(dropdownItem, enabledModules, { 'daily-allocation': 4 }, false)).toBe(true);
    // View As supplies effective flags; an actual admin viewing as Level 2 must pass isAdmin=false.
    expect(canAccessNavItem(managerItem!, enabledModules, { 'daily-allocation': 2 }, false)).toBe(false);
    expect(canAccessNavItem(managerItem!, new Set(), null, true)).toBe(true);
  });

  it('registers Daily Allocation forms and page-reporting metadata', () => {
    expect(FORM_TYPES).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'daily-allocation',
        href: '/daily-allocation/my',
        minimumAccessLevel: 2,
      }),
    ]));
    expect(MODULE_PAGES).toEqual(expect.arrayContaining([
      expect.objectContaining({
        module: 'daily-allocation',
        subPages: expect.arrayContaining([
          expect.objectContaining({ value: 'daily-allocation-board' }),
          expect.objectContaining({ value: 'daily-allocation-my' }),
          expect.objectContaining({ value: 'daily-allocation-job' }),
        ]),
      }),
    ]));
  });

  it('PERM-REL-01 classifies Daily Allocation paths and commit scopes', () => {
    expect(getReleaseDescriptorByScope('daily-allocation')).toMatchObject({
      id: 'daily-allocation',
      permissionModule: 'daily-allocation',
    });
    expect(getReleaseDescriptorMatches([
      { path: 'app/(dashboard)/daily-allocation/page.tsx' },
      { path: 'app/api/daily-allocation/board/route.ts' },
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        descriptor: expect.objectContaining({ id: 'daily-allocation' }),
        fileCount: 2,
      }),
    ]));
  });

  it('PERM-AUDIT-01 keeps the operational audit on the current permission model', () => {
    const auditScript = readFileSync(
      resolve(process.cwd(), 'scripts/audit-permissions.ts'),
      'utf8'
    );

    expect(auditScript).toContain("import { ALL_MODULES } from '../types/roles'");
    expect(auditScript).toContain('public.permission_modules');
    expect(auditScript).toContain('public.team_module_permissions');
    expect(auditScript).toContain('public.user_module_permissions');
    expect(auditScript).toContain('public.user_module_access_level');
    expect(auditScript).toContain('public.module_enforced_minimum_access_level');
    expect(auditScript).toContain('public.module_requires_full_access_role');
    expect(auditScript).not.toContain('pm.enforced_minimum_access_level');
    expect(auditScript).not.toContain('pm.requires_full_access_role');
    expect(auditScript).not.toContain('role_permissions');
    expect(auditScript).not.toContain('Managers have all access');
  });

  it('links the reusable module guide from the documentation index', () => {
    const guide = readFileSync(
      resolve(process.cwd(), 'docs/guides/ADDING_A_NEW_MODULE_WITH_PERMISSIONS.md'),
      'utf8'
    );
    const docsIndex = readFileSync(resolve(process.cwd(), 'docs/README.md'), 'utf8');

    expect(guide).toContain('## 7. Enforce APIs and database access');
    expect(guide).toContain('Level 2 for `/daily-allocation/my`');
    expect(guide).toContain('operator/type errors such as `42883`');
    expect(docsIndex).toContain('./guides/ADDING_A_NEW_MODULE_WITH_PERMISSIONS.md');
  });
});
