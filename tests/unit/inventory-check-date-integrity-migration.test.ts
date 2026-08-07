import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260807155000_inventory_check_date_integrity.sql'),
  'utf8',
);

describe('INV-CHECK-MIG-001 inventory check date integrity migration', () => {
  it('creates a service-only transactional recording RPC with sync and guard protections', () => {
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(/COMMIT;\s*$/);
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.inventory_record_check(');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('FUTURE_CHECK_CONFIRMATION_REQUIRED');
    expect(migration).toContain('submission_id');
    expect(migration).toContain('trg_inventory_check_history_sync_last_checked');
    expect(migration).toContain('trg_inventory_items_last_checked_history_guard');
    expect(migration).toContain('INVENTORY_CHECK_HISTORY_APPEND_ONLY');
    expect(migration).toContain('DROP POLICY IF EXISTS inventory_check_history_insert');
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.inventory_record_check[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.inventory_record_check[\s\S]*TO service_role/);
    expect(migration).toContain("SET search_path = public, pg_temp");
  });
});
