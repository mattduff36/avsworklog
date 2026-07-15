import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('Inventory Yard kiosk device migration contract', () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      'supabase/migrations/20260715_inventory_kiosk_device_pairing.sql',
    ),
    'utf8',
  );

  it('stores only hashed device credentials behind RLS', () => {
    expect(migration).toContain('inventory_kiosk_pairing_sessions');
    expect(migration).toContain('inventory_kiosk_devices');
    expect(migration).toContain('pairing_token_hash');
    expect(migration).toContain('device_token_hash');
    expect(migration).not.toMatch(/\bdevice_token\s+TEXT/i);
    expect(migration).toMatch(
      /ALTER TABLE public\.inventory_kiosk_pairing_sessions ENABLE ROW LEVEL SECURITY/,
    );
    expect(migration).toMatch(
      /ALTER TABLE public\.inventory_kiosk_devices ENABLE ROW LEVEL SECURITY/,
    );
  });

  it('links automatic sessions to revocable kiosk devices', () => {
    expect(migration).toContain('kiosk_device_id UUID');
    expect(migration).toContain("'kiosk_device'");
    expect(migration).toContain('app_auth_sessions_kiosk_device_active_idx');
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(/COMMIT;\s*$/);
  });

  it('enforces a single short-lived active pairing state', () => {
    expect(migration).toContain('inventory_kiosk_pairing_one_active_idx');
    expect(migration).toContain("WHERE status = 'active'");
    expect(migration).toContain(
      "status IN ('active', 'confirmed', 'consumed', 'cancelled', 'expired')",
    );
  });
});
