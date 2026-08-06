import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import permissionsAudit from '@/lib/config/permissions-secondary-audit.json';

describe('permissions guide', () => {
  it('PERM-GUIDE-01: permission-guide tab is relocated to protected Admin Settings', () => {
    const adminSettingsSource = fs.readFileSync(
      path.join(process.cwd(), 'app/(dashboard)/admin/settings/page.tsx'),
      'utf-8'
    );
    const usersSource = fs.readFileSync(
      path.join(process.cwd(), 'app/(dashboard)/admin/users/page.tsx'),
      'utf-8'
    );

    expect(adminSettingsSource).toContain("'permission-guide'");
    expect(adminSettingsSource).toContain("usePermissionCheck('admin-settings', false)");
    expect(adminSettingsSource).toContain("useSensitiveModuleAccess('admin-settings'");
    expect(adminSettingsSource).toContain('value="permission-guide"');
    expect(adminSettingsSource).toContain('<PermissionsGuide');
    expect(usersSource).toContain('href="/admin/settings?tab=permissions"');
    expect(usersSource).not.toContain('<PermissionsGuide');
  });

  it('PERM-GUIDE-02: guide keeps role behavior descriptions from secondary audit JSON', () => {
    const guideSource = fs.readFileSync(
      path.join(process.cwd(), 'components/admin/PermissionsGuide.tsx'),
      'utf-8'
    );

    expect(guideSource).toContain("import permissionsAudit from '@/lib/config/permissions-secondary-audit.json'");
    expect(guideSource).toContain('getModuleBrandSurfaceClasses');
    expect(guideSource).toContain('brandSurface.card');
    expect(guideSource).toContain('brandSurface.cardHover');
    expect(guideSource).toContain('getGuideRoleBadge');
    expect(guideSource).toContain('border-border bg-[#0f172a] p-3');
    expect(guideSource).not.toContain('AccordionContent className="bg-slate-900');
    expect(guideSource).not.toContain('bg-muted/30');
    expect(guideSource).not.toContain('bg-background');
    expect(guideSource).not.toContain('Min: {module.minimumRole}');
    expect(guideSource).not.toContain('module.matrixGate');
    expect(guideSource).toMatch(/getModuleBrandSurfaceClasses\(module\.moduleName\)/);
    expect(guideSource).toContain('ROLE_ORDER');
    expect(guideSource).toContain('Accordion');
    expect(guideSource).not.toContain('HIDDEN_GUIDE_MODULES');
    expect(guideSource).toContain('module.byRole[role]');

    expect(permissionsAudit.modules.length).toBeGreaterThan(0);
    expect(permissionsAudit.modules.some((module) => module.moduleName === 'reminders')).toBe(true);
    for (const auditModule of permissionsAudit.modules) {
      expect(auditModule.byRole.Contractor).toBeTruthy();
      expect(auditModule.byRole.Employee).toBeTruthy();
      expect(auditModule.byRole.Supervisor).toBeTruthy();
      expect(auditModule.byRole.Manager).toBeTruthy();
      expect(auditModule.byRole.Admin).toBeTruthy();
    }
  });

  it('GUIDE-LIVE-01: guide fetches live minima/PIN/access_mode from permissions users API', () => {
    const guideSource = fs.readFileSync(
      path.join(process.cwd(), 'components/admin/PermissionsGuide.tsx'),
      'utf-8'
    );
    const usersRouteSource = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/permissions/users/route.ts'),
      'utf-8'
    );
    const teamPermissionsSource = fs.readFileSync(
      path.join(process.cwd(), 'lib/server/team-permissions.ts'),
      'utf-8'
    );

    expect(guideSource).toContain("fetch('/api/admin/permissions/users'");
    expect(guideSource).toContain('GUIDE-LIVE');
    expect(guideSource).toContain('enforced_minimum_access_level');
    expect(guideSource).toContain('requires_sensitive_pin');
    expect(guideSource).toContain('access_mode');
    expect(guideSource).toContain('PERMISSION_LEVEL_LABELS');
    expect(usersRouteSource).toContain('access_mode');
    expect(usersRouteSource).toContain('live enforced minima');
    expect(teamPermissionsSource).toContain('access_mode');
    expect(teamPermissionsSource).toContain("select('module_name, minimum_role_id, requires_sensitive_pin, access_mode, sort_order')");
  });

  it('GUIDE-LIVE-02: Admin Settings Level 5 retains PIN gate and no delegated view-as', () => {
    const accessSource = fs.readFileSync(
      path.join(process.cwd(), 'lib/server/admin-settings-access.ts'),
      'utf-8'
    );
    const viewAsSource = fs.readFileSync(
      path.join(process.cwd(), 'lib/contexts/ViewAsContext.tsx'),
      'utf-8'
    );
    const mutationSource = fs.readFileSync(
      path.join(process.cwd(), 'lib/server/permission-matrix-mutations.ts'),
      'utf-8'
    );

    expect(accessSource).toContain("canEffectiveRoleUseModuleLevel('admin-settings', 5)");
    expect(accessSource).toContain("requireSensitiveModuleAccess('admin-settings')");
    expect(viewAsSource).toContain('isSuperAdmin ? viewAsRoleId : ');
    expect(mutationSource).toContain('INSERT INTO public.audit_log');
    expect(mutationSource).toContain('permission_matrix_update');
  });
});
