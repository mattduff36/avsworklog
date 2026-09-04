import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('Projects / Toolbox Talks permission gates (Phase 2)', () => {
  it('PROJECT-MANAGE: manage mutations and all=true listing require rams Level 4', () => {
    const ramsList = read('app/api/rams/route.ts');
    const upload = read('app/api/rams/upload/route.ts');
    const assign = read('app/api/rams/[id]/assign/route.ts');
    const deleteRoute = read('app/api/rams/[id]/delete/route.ts');
    const documentTypes = read('app/api/projects/document-types/route.ts');
    const managePage = read('app/(dashboard)/projects/manage/page.tsx');
    const settingsPage = read('app/(dashboard)/projects/settings/page.tsx');

    expect(ramsList).toContain("canEffectiveRoleAccessModule('rams')");
    expect(ramsList).toContain("canEffectiveRoleUseModuleLevel('rams', 4)");
    expect(ramsList).toContain('showAll');

    for (const source of [upload, assign, deleteRoute, documentTypes]) {
      expect(source).toContain("canEffectiveRoleUseModuleLevel('rams', 4)");
    }

    expect(documentTypes).not.toContain("role_class === 'employee'");
    expect(managePage).toContain("useModuleAccessLevel('rams')");
    expect(managePage).toContain('canUseLevel(4)');
    expect(settingsPage).toContain("useModuleAccessLevel('rams')");
    expect(settingsPage).toContain('canUseLevel(4)');
  });

  it('PROJECT-SCOPE: personal favourites stay rams access (>0), not Level 4 / employee-class', () => {
    const favourites = read('app/api/projects/favourites/route.ts');

    expect(favourites).toContain("canEffectiveRoleAccessModule('rams')");
    expect(favourites).not.toContain("canEffectiveRoleUseModuleLevel('rams', 4)");
    expect(favourites).not.toContain("role_class === 'employee'");
    expect(favourites).toContain(".eq('user_id', user.id)");
  });

  it('TOOLBOX-TIER: create/export/delete/manual reminder require toolbox-talks Level 4', () => {
    const create = read('app/api/messages/route.ts');
    const exportRoute = read('app/api/messages/[id]/export/route.ts');
    const deleteRoute = read('app/api/messages/[id]/delete/route.ts');
    const manualReminder = read('app/api/reminders/manual/route.ts');
    const toolboxPage = read('app/(dashboard)/toolbox-talks/page.tsx');

    for (const source of [create, exportRoute, deleteRoute, manualReminder]) {
      expect(source).toContain("canEffectiveRoleUseModuleLevel('toolbox-talks', 4)");
      expect(source).not.toContain("canEffectiveRoleAccessModule('toolbox-talks')");
    }

    expect(toolboxPage).toContain("useModuleAccessLevel('toolbox-talks')");
    expect(toolboxPage).toContain('canUseLevel(4)');
  });

  it('FD-GIT-SCOPE-001: required assignment IDs appear once in tracked test titles', () => {
    const sources = [
      read('tests/integration/api/user-directory-route.test.ts'),
      read('tests/unit/projects-toolbox-permission-gates.test.ts'),
      read('tests/unit/user-directory-client.test.ts'),
      read('tests/unit/rams-assign-route.test.ts'),
      read('tests/unit/rams-assignments-delete-policy-migration.test.ts'),
    ].join('\n');
    const requiredIds = [
      'RLS-RAMS-DEL-001',
      'DIR-RAMS-ASSIGN-001',
      'DIR-RAMS-ASSIGN-002',
      'DIR-RAMS-ASSIGN-003',
      'DIR-RAMS-ASSIGN-004',
      'ASSIGN-UNASSIGN-001',
      'ASSIGN-SIGNED-001',
      'T-EXISTING-DIR-GATES',
    ];
    for (const id of requiredIds) {
      const matches = sources.match(new RegExp(`it\\('${id}:`, 'g')) ?? [];
      expect(matches, id).toHaveLength(1);
    }
  });

  it('DIR-RAMS-ASSIGN-004: AssignEmployeesModal requests the rams-assignment directory context', () => {
    const modal = read('components/rams/AssignEmployeesModal.tsx');
    expect(modal).toContain("context: 'rams-assignment'");
    expect(modal).toContain("module: 'rams'");
  });

  it('unassign delete excludes signed rows in the mutation predicate', () => {
    const assign = read('app/api/rams/[id]/assign/route.ts');
    expect(assign).toContain(".eq('status', 'signed')");
    expect(assign).toContain(".neq('status', 'signed')");
    expect(assign).toContain(".select('employee_id')");
    expect(assign).toContain('signedEmployeeIds');
  });

  it('TOOLBOX-REPORT: toolbox reports use toolbox Level 4 only (no reports module coupling)', () => {
    const reports = read('app/api/messages/reports/route.ts');

    expect(reports).toContain("canEffectiveRoleUseModuleLevel('toolbox-talks', 4)");
    expect(reports).not.toContain("canEffectiveRoleAccessModule('reports')");
    expect(reports).not.toContain("canEffectiveRoleAccessModule('toolbox-talks')");
  });
});
