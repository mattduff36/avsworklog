import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  InventoryKioskError,
  validateYardKioskSubmitPayload,
} from '@/lib/server/inventory-kiosk';

const counterpartId = '11111111-1111-4111-8111-111111111111';
const serializedId = '22222222-2222-4222-8222-222222222222';
const hardwareId = '33333333-3333-4333-8333-333333333333';

describe('Inventory Yard kiosk validation', () => {
  it('accepts one mixed basket and strips client-controlled actor/location fields', () => {
    const payload = validateYardKioskSubmitPayload({
      direction: 'take',
      counterpart_location_id: counterpartId,
      serialized_item_ids: [serializedId],
      hardware_lines: [{
        item_id: hardwareId,
        quantity: 4,
        from_location_id: 'client-controlled',
        to_location_id: 'client-controlled',
      }],
      actor: 'client-controlled',
      note: '  Site setup  ',
    });

    expect(payload).toEqual({
      direction: 'take',
      counterpart_location_id: counterpartId,
      serialized_item_ids: [serializedId],
      hardware_lines: [{ item_id: hardwareId, quantity: 4 }],
      note: 'Site setup',
    });
    expect(payload).not.toHaveProperty('actor');
  });

  it.each([
    {
      name: 'an empty basket',
      payload: {
        direction: 'return',
        counterpart_location_id: counterpartId,
        serialized_item_ids: [],
        hardware_lines: [],
      },
    },
    {
      name: 'duplicate serialized ids',
      payload: {
        direction: 'take',
        counterpart_location_id: counterpartId,
        serialized_item_ids: [serializedId, serializedId],
        hardware_lines: [],
      },
    },
    {
      name: 'fractional Hardware quantity',
      payload: {
        direction: 'take',
        counterpart_location_id: counterpartId,
        serialized_item_ids: [],
        hardware_lines: [{ item_id: hardwareId, quantity: 1.5 }],
      },
    },
  ])('rejects $name before database mutation', ({ payload }) => {
    expect(() => validateYardKioskSubmitPayload(payload)).toThrow(InventoryKioskError);
  });
});

describe('Inventory Yard kiosk migration contract', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260714_inventory_yard_kiosk.sql'),
    'utf8',
  );

  it('keeps mixed transfers inside one database transaction and derives locations', () => {
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(/COMMIT;\s*$/);
    expect(migration).toContain("IF p_direction = 'take' THEN");
    expect(migration).toContain('v_source_location_id := v_yard_location_id');
    expect(migration).toContain('v_destination_location_id := v_yard_location_id');
    expect(migration).toContain('inventory_transfer_items(');
    expect(migration).toContain('inventory_transfer_hardware_stock(');
  });

  it('fails closed for actor, Yard checks, stale stock, and direct RPC access', () => {
    expect(migration).toContain('kiosk_user_id = p_actor');
    expect(migration).toContain("location_type = 'yard'");
    expect(migration).toContain('Inventory check required before leaving Yard');
    expect(migration).toContain('Hardware quantities are unavailable at the source location');
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]+TO service_role/);
  });
});
