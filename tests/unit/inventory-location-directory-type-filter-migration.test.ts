import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260807163000_inventory_location_directory_type_filter.sql',
  ),
  'utf-8',
);

describe('inventory location directory type filter migration contract', () => {
  it('drops both four-arg and five-arg signatures before recreating the function', () => {
    expect(migration).toContain(
      'DROP FUNCTION IF EXISTS public.inventory_search_locations(TEXT, BOOLEAN, INTEGER, INTEGER);',
    );
    expect(migration).toContain(
      'DROP FUNCTION IF EXISTS public.inventory_search_locations(TEXT, BOOLEAN, INTEGER, INTEGER, TEXT[]);',
    );
  });

  it('adds nullable p_location_types last with empty/null meaning all types', () => {
    expect(migration).toContain('p_location_types TEXT[] DEFAULT NULL');
    expect(migration).toContain('COALESCE(cardinality(p_location_types), 0) = 0');
    expect(migration).toContain('il.location_type = ANY(p_location_types)');
  });

  it('preserves search, legacy filtering, ordering, invoker security, and service_role grant', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain("OR il.source_type IS DISTINCT FROM 'legacy_quote'");
    expect(migration).toContain('ORDER BY il.name ASC, il.id ASC');
    expect(migration).toContain('COUNT(*) OVER() AS total_count');
    expect(migration).toContain("ILIKE v_pattern ESCAPE E'\\\\'");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.inventory_search_locations(TEXT, BOOLEAN, INTEGER, INTEGER, TEXT[])',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.inventory_search_locations(TEXT, BOOLEAN, INTEGER, INTEGER, TEXT[])',
    );
    expect(migration).toContain('TO service_role;');
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
  });
});
