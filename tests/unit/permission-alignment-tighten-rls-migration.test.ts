import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260806_permission_alignment_tighten_rls.sql'
  ),
  'utf-8'
);

describe('Permission Alignment Phase 3 RLS migration', () => {
  it('RLS-POLICY-001: replaces permissive management policies with module-level boundaries', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.effective_has_module_level'
    );
    expect(migration).toContain(
      "public.effective_module_access_level(target_module) >= minimum_level"
    );

    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Managers and recipients can view messages" ON public.messages'
    );
    expect(migration).toContain(
      "public.effective_has_module_level('toolbox-talks', 4)"
    );
    expect(migration).toContain(
      'CREATE POLICY "Users can view assigned messages" ON public.messages'
    );
    expect(migration).toContain(
      'CREATE POLICY "Users can update their recipients" ON public.message_recipients'
    );

    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Managers can create RAMS documents" ON public.rams_documents'
    );
    expect(migration).toContain("public.effective_has_module_level('rams', 4)");
    expect(migration).toContain(
      'CREATE POLICY "Employees can view assigned RAMS" ON public.rams_documents'
    );
    expect(migration).toContain(
      'CREATE POLICY "Employees can sign their assignments" ON public.rams_assignments'
    );

    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Users can add vans" ON public.vans'
    );
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Admins can manage vehicles" ON public.vans'
    );
    expect(migration).toContain(
      "public.effective_has_module_level('admin-vans', 3)"
    );
    expect(migration).toContain(
      "public.effective_has_module_level('admin-vans', 4)"
    );
    expect(migration).not.toContain(
      'WITH CHECK ((SELECT auth.uid()) IS NOT NULL)'
    );
    expect(migration).not.toContain(
      "status IN ('active', 'maintenance')"
    );

    expect(migration).toContain(
      "public.effective_has_module_level('maintenance', 3)"
    );
    expect(migration).toContain(
      "public.effective_has_module_level('maintenance', 4)"
    );

    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Managers can create actions" ON public.actions'
    );
    expect(migration).toContain(
      "public.effective_has_module_level('actions', 4)"
    );
    expect(migration).not.toContain(
      'DROP POLICY IF EXISTS "Authenticated users can create actions"'
    );
    expect(migration).not.toContain(
      'DROP POLICY IF EXISTS "Workshop users can create workshop tasks"'
    );

    expect(migration).toContain(
      'DROP POLICY IF EXISTS inventory_item_groups_insert ON public.inventory_item_groups'
    );
    expect(migration).toContain(
      "public.effective_has_module_level('inventory', 4)"
    );
    expect(migration).toContain(
      "public.effective_has_module_level('inventory', 1)"
    );
    expect(migration).not.toContain(
      'DROP POLICY IF EXISTS inventory_user_site_locations'
    );
  });
});
