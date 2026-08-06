import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf-8');
}

describe('Fleet/Maintenance Level 3-5 permission gates', () => {
  it('FLEET-TIERS: maintenance and fleet mutation routes enforce module levels', () => {
    const maintenanceId = readRepoFile('app/api/maintenance/[id]/route.ts');
    const byVehicle = readRepoFile('app/api/maintenance/by-vehicle/[vehicleId]/route.ts');
    const history = readRepoFile('app/api/maintenance/history/[vehicleId]/route.ts');
    const plantHistory = readRepoFile('app/api/maintenance/history/plant/[plantId]/route.ts');
    const motHistory = readRepoFile('app/api/maintenance/mot-history/[vehicleId]/route.ts');
    const categories = readRepoFile('app/api/maintenance/categories/route.ts');
    const categoryId = readRepoFile('app/api/maintenance/categories/[id]/route.ts');
    const recipients = readRepoFile('app/api/maintenance/categories/[id]/recipients/route.ts');
    const deleted = readRepoFile('app/api/maintenance/deleted/route.ts');
    const deletedPermanent = readRepoFile('app/api/maintenance/deleted/[archiveId]/route.ts');
    const deletedRestore = readRepoFile('app/api/maintenance/deleted/[archiveId]/restore/route.ts');
    const vans = readRepoFile('app/api/admin/vans/route.ts');
    const vansId = readRepoFile('app/api/admin/vans/[id]/route.ts');
    const plant = readRepoFile('app/api/admin/plant/route.ts');
    const plantId = readRepoFile('app/api/admin/plant/[id]/route.ts');
    const hgvs = readRepoFile('app/api/admin/hgvs/route.ts');
    const hgvsId = readRepoFile('app/api/admin/hgvs/[id]/route.ts');
    const fleetCategories = readRepoFile('app/api/admin/categories/route.ts');
    const fleetCategoriesId = readRepoFile('app/api/admin/categories/[id]/route.ts');
    const hgvCategories = readRepoFile('app/api/admin/hgv-categories/route.ts');
    const hgvCategoriesId = readRepoFile('app/api/admin/hgv-categories/[id]/route.ts');
    const authHelper = readRepoFile('lib/server/fleet-maintenance-auth.ts');
    const maintenancePage = readRepoFile('app/(dashboard)/maintenance/page.tsx');
    const maintenanceSettings = readRepoFile('app/(dashboard)/maintenance/components/MaintenanceSettings.tsx');
    const fleetPage = readRepoFile('app/(dashboard)/fleet/page.tsx');
    const fleetSettings = readRepoFile('app/(dashboard)/fleet/components/FleetSettingsTab.tsx');

    expect(authHelper).toContain("canEffectiveRoleUseModuleLevel('maintenance'");
    expect(authHelper).toContain("canEffectiveRoleUseModuleLevel('admin-vans'");

    expect(maintenanceId).toContain('requireMaintenanceLevel(3');
    expect(maintenanceId).toContain('requireMaintenanceLevel(5');
    expect(byVehicle).toContain('requireMaintenanceLevel(3');
    expect(history).toContain('requireMaintenanceLevel(3');
    expect(plantHistory).toContain('requireMaintenanceLevel(3');
    expect(motHistory).toContain('requireMaintenanceLevel(3');

    expect(categories).toContain('requireMaintenanceLevel(3');
    expect(categories).toMatch(/requireMaintenanceLevel\(\s*4/);
    expect(categoryId).toMatch(/requireMaintenanceLevel\(\s*4/);
    expect(recipients).toMatch(/requireMaintenanceLevel\(\s*4/);

    expect(deleted).toMatch(/requireMaintenanceLevel\(\s*4/);
    expect(deletedRestore).toMatch(/requireMaintenanceLevel\(\s*4/);
    expect(deletedPermanent).toMatch(/requireMaintenanceLevel\(\s*5/);
    expect(deletedPermanent).not.toContain('role_class');

    expect(vans).toContain("canEffectiveRoleUseModuleLevel('admin-vans', 3)");
    expect(vans).toContain("canEffectiveRoleUseModuleLevel('admin-vans', 4)");
    expect(vansId).toContain("canEffectiveRoleUseModuleLevel('admin-vans', 4)");
    expect(plant).toContain("canEffectiveRoleUseModuleLevel('admin-vans', 4)");
    expect(plantId).toContain("canEffectiveRoleUseModuleLevel('admin-vans', 4)");
    expect(hgvs).toContain("canEffectiveRoleUseModuleLevel('admin-vans', 3)");
    expect(hgvs).toContain("canEffectiveRoleUseModuleLevel('admin-vans', 4)");
    expect(hgvsId).toContain("canEffectiveRoleUseModuleLevel('admin-vans', 4)");

    expect(fleetCategories).toContain('requireFleetLevel(3');
    expect(fleetCategories).toContain('requireFleetLevel(5');
    expect(fleetCategoriesId).toContain('requireFleetLevel(5');
    expect(hgvCategories).toContain('requireFleetLevel(3');
    expect(hgvCategories).toContain('requireFleetLevel(5');
    expect(hgvCategoriesId).toContain('requireFleetLevel(5');

    expect(maintenancePage).toContain("useModuleAccessLevel('maintenance')");
    expect(maintenancePage).toContain('canUseLevel(4)');
    expect(maintenanceSettings).toContain("useModuleAccessLevel('maintenance')");
    expect(fleetPage).toContain("useModuleAccessLevel('admin-vans')");
    expect(fleetPage).toContain('canUseLevel(4)');
    expect(fleetSettings).toContain('canManageCategories');
  });

  it('FLEET-DVLA: manual sync requires dual Level 4; scheduled cron keeps CRON_SECRET', () => {
    const syncDvla = readRepoFile('app/api/maintenance/sync-dvla/route.ts');
    const scheduled = readRepoFile('app/api/maintenance/sync-dvla-scheduled/route.ts');
    const authHelper = readRepoFile('lib/server/fleet-maintenance-auth.ts');

    expect(syncDvla).toContain('requireManualDvlaSyncAccess');
    expect(syncDvla).toContain('triggeredBy: auth.user.id');
    expect(syncDvla).not.toContain('triggeredBy: user.id');
    expect(authHelper).toContain("canEffectiveRoleUseModuleLevel('maintenance', 4)");
    expect(authHelper).toContain("canEffectiveRoleUseModuleLevel('admin-vans', 4)");
    expect(scheduled).toContain('CRON_SECRET');
    expect(scheduled).not.toContain('requireManualDvlaSyncAccess');
    expect(scheduled).not.toContain('canEffectiveRoleUseModuleLevel');
  });
});
