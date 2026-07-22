import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('Inventory Yard kiosk remote control migration contract', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260722_inventory_kiosk_remote_control.sql',
    ),
    'utf8',
  );

  it('enforces one active kiosk globally after deterministic cleanup', () => {
    expect(migration).toContain('inventory_kiosk_devices_to_revoke');
    expect(migration).toContain("'migration_dedupe'");
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS inventory_kiosk_devices_one_active_idx[\s\S]*ON public\.inventory_kiosk_devices \(\(TRUE\)\)[\s\S]*WHERE revoked_at IS NULL/,
    );
  });

  it('adds replacement, workflow snapshot, and lease fields', () => {
    expect(migration).toContain('replaces_device_id UUID');
    expect(migration).toContain('last_workflow_snapshot JSONB');
    expect(migration).toContain('workflow_state_version BIGINT');
    expect(migration).toContain('control_holder_user_id UUID');
    expect(migration).toContain('control_lease_expires_at TIMESTAMPTZ');
    expect(migration).toContain("'control_action'");
  });

  it('performs replacement atomically in a service-role-only function', () => {
    expect(migration).toContain('inventory_kiosk_confirm_device_pairing');
    expect(migration).toContain('KIOSK_REPLACEMENT_CONFIRMATION_REQUIRED');
    expect(migration).toContain("'replaced_by_pairing'");
    expect(migration).toContain("'kiosk_device_replaced'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.inventory_kiosk_confirm_device_pairing[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.inventory_kiosk_confirm_device_pairing[\s\S]*TO service_role/,
    );
  });
});
