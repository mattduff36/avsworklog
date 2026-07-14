import { describe, expect, it } from 'vitest';
import {
  getHardwareDatabaseErrorMessage,
  isHardwareAdjustmentOperation,
  isHardwareAdjustmentReason,
  isValidHardwareQuantity,
} from '@/lib/server/inventory-hardware';

describe('Inventory Hardware validation', () => {
  it('accepts only supported adjustment operations and reasons', () => {
    expect(isHardwareAdjustmentOperation('add')).toBe(true);
    expect(isHardwareAdjustmentOperation('remove')).toBe(true);
    expect(isHardwareAdjustmentOperation('recount')).toBe(true);
    expect(isHardwareAdjustmentOperation('transfer')).toBe(false);

    expect(isHardwareAdjustmentReason('Delivery')).toBe(true);
    expect(isHardwareAdjustmentReason('Stocktake correction')).toBe(true);
    expect(isHardwareAdjustmentReason('Transfer')).toBe(false);
  });

  it('requires whole positive quantities except zero-value recounts', () => {
    expect(isValidHardwareQuantity(3)).toBe(true);
    expect(isValidHardwareQuantity(0)).toBe(false);
    expect(isValidHardwareQuantity(0, true)).toBe(true);
    expect(isValidHardwareQuantity(-1, true)).toBe(false);
    expect(isValidHardwareQuantity(1.5)).toBe(false);
    expect(isValidHardwareQuantity('3')).toBe(false);
  });

  it('returns safe messages for known stock errors', () => {
    expect(getHardwareDatabaseErrorMessage({
      message: 'P0001: Insufficient Hardware stock at source location',
    })).toBe('Insufficient Hardware stock at source location');
    expect(getHardwareDatabaseErrorMessage(new Error('database unavailable')))
      .toBe('Unable to update Hardware stock');
  });
});
