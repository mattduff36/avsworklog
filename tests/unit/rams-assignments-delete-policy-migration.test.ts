import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('RAMS assignment DELETE policy migration', () => {
  it('RLS-RAMS-DEL-001: forward migration adds Level 4 DELETE without editing the historical RLS file', () => {
    const forward = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260904_rams_assignments_manager_delete_policy.sql'),
      'utf8'
    );
    const historical = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260806_permission_alignment_tighten_rls.sql'
      ),
      'utf8'
    );

    expect(forward).toContain('CREATE POLICY "Managers can delete assignments"');
    expect(forward).toContain('ON public.rams_assignments');
    expect(forward).toContain('FOR DELETE');
    expect(forward).toContain("effective_has_module_level('rams', 4)");
    expect(forward).not.toContain('TO service_role');

    expect(historical).not.toContain('Managers can delete assignments');
    expect(historical).toContain("public.effective_has_module_level('rams', 4)");
    expect(historical).toContain('CREATE POLICY "Managers can create assignments"');
  });
});
