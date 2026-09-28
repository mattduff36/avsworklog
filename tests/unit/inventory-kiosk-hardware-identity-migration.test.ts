import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Inventory kiosk hardware identity migration', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260928193000_inventory_kiosk_hardware_identity.sql',
    ),
    'utf8',
  );

  it('binds an active kiosk row to one attested Android public key', () => {
    expect(migration).toContain("hardware_identity_kind = 'android_keystore'");
    expect(migration).toContain('hardware_public_key_spki');
    expect(migration).toContain('hardware_key_fingerprint');
    expect(migration).toContain('inventory_kiosk_devices_active_hardware_key_idx');
    expect(migration).toContain('candidate_hardware_public_key_spki');
    expect(migration).toContain('candidate_identity_kind');
  });

  it('stores one-time challenges and replay identifiers behind deny-all RLS', () => {
    expect(migration).toContain('inventory_kiosk_device_challenges');
    expect(migration).toContain('inventory_kiosk_device_request_proofs');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('TO anon, authenticated');
    expect(migration).toContain('USING (FALSE)');
    expect(migration).toContain('request_id UUID PRIMARY KEY');
    expect(migration).toContain('consumed_at TIMESTAMPTZ');
  });

  it('copies pending hardware identity in the atomic manager confirmation RPC', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.inventory_kiosk_confirm_device_pairing',
    );
    expect(migration).toContain('v_pairing.candidate_hardware_public_key_spki');
    expect(migration).toContain('KIOSK_HARDWARE_IDENTITY_INCOMPLETE');
    expect(migration).toContain("'kiosk_device_replaced'");
    expect(migration).toMatch(/^-- finalise-phase: predeploy\r?\nBEGIN;/);
    expect(migration).toMatch(/COMMIT;\s*$/);
  });

  it('locks the active hardware device while the transfer RPC executes', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.inventory_kiosk_execute_hardware_bound_basket',
    );
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('Yard kiosk hardware device is inactive');
    expect(migration).toContain('public.inventory_kiosk_execute_transfer_basket(');
  });
});
