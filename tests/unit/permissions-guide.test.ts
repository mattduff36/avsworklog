import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import permissionsAudit from '@/lib/config/permissions-secondary-audit.json';

describe('permissions guide', () => {
  it('PERM-GUIDE-01: permission-guide tab is gated with permissions tab visibility', () => {
    const pageSource = fs.readFileSync(
      path.join(process.cwd(), 'app/(dashboard)/admin/users/page.tsx'),
      'utf-8'
    );

    expect(pageSource).toContain("'permission-guide'");
    expect(pageSource).toContain('canEditRolePermissions');
    expect(pageSource).toContain('value="permission-guide"');
    expect(pageSource).toContain('<PermissionsGuide');
  });

  it('PERM-GUIDE-02: guide component renders every audit module/role from JSON source', () => {
    const guideSource = fs.readFileSync(
      path.join(process.cwd(), 'components/admin/PermissionsGuide.tsx'),
      'utf-8'
    );

    expect(guideSource).toContain("import permissionsAudit from '@/lib/config/permissions-secondary-audit.json'");
    expect(guideSource).toContain('ROLE_ORDER');
    expect(guideSource).toContain('Accordion');
    expect(guideSource).not.toContain('HIDDEN_GUIDE_MODULES');

    expect(permissionsAudit.modules.length).toBeGreaterThan(0);
    expect(permissionsAudit.modules.some((module) => module.moduleName === 'reminders')).toBe(true);
    for (const module of permissionsAudit.modules) {
      expect(module.byRole.Contractor).toBeTruthy();
      expect(module.byRole.Employee).toBeTruthy();
      expect(module.byRole.Supervisor).toBeTruthy();
      expect(module.byRole.Manager).toBeTruthy();
      expect(module.byRole.Admin).toBeTruthy();
    }
  });
});
