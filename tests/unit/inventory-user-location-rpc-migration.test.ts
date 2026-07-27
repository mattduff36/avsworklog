import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260727133500_fix_inventory_user_location_rpc_ambiguity.sql',
  ),
  'utf-8',
);

describe('inventory user location RPC ambiguity migration', () => {
  it('uses the primary-key constraint instead of an ambiguous output-column name', () => {
    expect(migration).toContain(
      'ON CONFLICT ON CONSTRAINT inventory_user_locations_pkey DO UPDATE',
    );
    expect(migration).not.toContain('ON CONFLICT (user_id) DO UPDATE');
  });

  it('preserves the inventory and fleet assignment transaction contract', () => {
    expect(migration).toContain('INSERT INTO public.inventory_user_locations');
    expect(migration).toContain('UPDATE public.profile_fleet_assignments');
    expect(migration).toContain('INSERT INTO public.profile_fleet_assignments');
    expect(migration).toContain(
      'WHERE inventory_user_locations.user_id = p_user_id;',
    );
  });
});
