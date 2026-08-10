import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260810_restore_inspection_van_insert_rls.sql'),
  'utf-8'
);
const runner = readFileSync(
  resolve(process.cwd(), 'scripts/run-restore-inspection-van-insert-rls-migration.ts'),
  'utf-8'
);
const page = readFileSync(
  resolve(process.cwd(), 'app/(dashboard)/van-inspections/new/page.tsx'),
  'utf-8'
);
const changePasswordPage = readFileSync(
  resolve(process.cwd(), 'app/(auth)/change-password/page.tsx'),
  'utf-8'
);

describe('Restore inspection van INSERT RLS', () => {
  it('VAN-RLS-007: migration replaces insert policy with constrained inspection OR fleet Level 4 check', () => {
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
    expect(migration).toContain('DROP POLICY IF EXISTS "Users can add vans" ON public.vans');
    expect(migration).toContain('CREATE POLICY "Users can add vans" ON public.vans');
    expect(migration).toContain("effective_has_module_level('admin-vans', 4)");
    expect(migration).toContain("effective_has_module_permission('inspections')");
    expect(migration).toContain("status = 'active'");
    expect(migration).toContain("COALESCE(asset_type, 'vehicle') = 'vehicle'");
    expect(migration).toContain('plant_id IS NULL');
    expect(migration).toContain('serial_number IS NULL');
    expect(migration).toContain('FROM public.van_categories vc');
    expect(migration).toContain("'van' = ANY (vc.applies_to)");
    expect(migration).not.toContain('WITH CHECK ((SELECT auth.uid()) IS NOT NULL)');
    expect(migration).not.toContain('FOR ALL');
  });

  it('VAN-RLS-VERIFY-001: runner verifies exact Fleet Level 4 and van-applicable category checks', () => {
    expect(runner).toContain('POSTGRES_URL_NON_POOLING');
    expect(runner).not.toContain('POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL');
    expect(runner).toContain("'admin-vans'(?:::\\w+)?\\s*,\\s*4\\s*\\)");
    expect(runner).toContain('hasFleetLevel4Check(withCheck)');
    expect(runner).toContain('hasFleetLevel4Check(updateQual)');
    expect(runner).toContain('hasFleetLevel4Check(deleteQual)');
    expect(runner).toContain("'(?:van|vehicle)'(?:::\\w+)?\\s*=\\s*ANY");
    expect(runner).toContain('[^)]*applies_to');
    expect(runner).toContain('hasVanApplicableCategoryCheck(withCheck)');
    expect(runner).toContain("updatePolicies.length !== 1");
    expect(runner).toContain("deletePolicies.length !== 1");
  });

  it('VAN-RLS-006: inspection add-vehicle keeps duplicate UX and maps RLS denials', () => {
    expect(page).toContain("vehicleError.code === '23505'");
    expect(page).toContain('DUPLICATE_VEHICLE_REGISTRATION_MESSAGE');
    expect(page).toContain("vehicleError.code === '42501'");
    expect(page).toContain('van-inspections-new-add-vehicle-rls');
    expect(page).toContain('isApplicableToType');
    expect(page).toContain(".select('id, name, applies_to')");
  });

  it('PASSWORD-LOG-001/002: incorrect password is not console.error; unexpected failures still log', () => {
    expect(changePasswordPage).toContain("message === 'Current password is incorrect'");
    expect(changePasswordPage).toContain('isExpectedPasswordChangeFailure');
    expect(changePasswordPage).toMatch(/if\s*\(\s*!isExpectedPasswordChangeFailure[\s\S]*console\.error/);
  });
});
