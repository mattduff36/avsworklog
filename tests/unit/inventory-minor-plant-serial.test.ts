import { describe, expect, it, vi } from 'vitest';
import {
  parseMinorPlantSerialNumber,
  saveMinorPlantSerialNumber,
} from '@/lib/server/inventory-minor-plant-serial';

describe('parseMinorPlantSerialNumber', () => {
  it('normalizes optional serial numbers', () => {
    expect(parseMinorPlantSerialNumber(' ab 123 ')).toEqual({ ok: true, value: 'AB123' });
    expect(parseMinorPlantSerialNumber('')).toEqual({ ok: true, value: null });
    expect(parseMinorPlantSerialNumber(null)).toEqual({ ok: true, value: null });
  });

  it('rejects serial numbers that are not alphanumeric', () => {
    expect(parseMinorPlantSerialNumber('AB-123')).toEqual({
      ok: false,
      error: 'Serial Number must contain only letters and numbers',
    });
  });
});

describe('saveMinorPlantSerialNumber', () => {
  it('updates an existing minor plant detail row', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const admin = {
      from: vi.fn().mockReturnValue({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'detail-1' }, error: null }),
          }),
        }),
        update,
        insert: vi.fn(),
      }),
    };

    await saveMinorPlantSerialNumber(admin as never, {
      inventoryItemId: 'item-1',
      serialNumber: 'SN100',
      userId: 'user-1',
    });

    expect(update).toHaveBeenCalledWith({
      serial_number: 'SN100',
      updated_by: 'user-1',
    });
  });

  it('inserts a detail row when a serial number is first recorded', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const admin = {
      from: vi.fn().mockReturnValue({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        update: vi.fn(),
        insert,
      }),
    };

    await saveMinorPlantSerialNumber(admin as never, {
      inventoryItemId: 'item-1',
      serialNumber: 'SN100',
      userId: 'user-1',
    });

    expect(insert).toHaveBeenCalledWith({
      inventory_item_id: 'item-1',
      serial_number: 'SN100',
      created_by: 'user-1',
      updated_by: 'user-1',
    });
  });

  it('leaves items without a detail row unchanged when the serial number is blank', async () => {
    const insert = vi.fn();
    const update = vi.fn();
    const admin = {
      from: vi.fn().mockReturnValue({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        update,
        insert,
      }),
    };

    await saveMinorPlantSerialNumber(admin as never, {
      inventoryItemId: 'item-1',
      serialNumber: null,
      userId: 'user-1',
    });

    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
