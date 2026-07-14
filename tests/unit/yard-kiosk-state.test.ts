import { describe, expect, it } from 'vitest';
import {
  INITIAL_YARD_KIOSK_STATE,
  getBasketSummary,
  yardKioskReducer,
} from '@/app/yard-kiosk/yard-kiosk-state';
import type { YardKioskStockItem } from '@/lib/inventory/kiosk-types';

const serializedItem: Extract<YardKioskStockItem, { kind: 'serialized' }> = {
  kind: 'serialized',
  id: '11111111-1111-4111-8111-111111111111',
  item_number: 'TOOL-001',
  name: 'Breaker',
  category: 'tools',
  check_status: 'ok',
  is_check_blocked: false,
};

const hardwareItem: Extract<YardKioskStockItem, { kind: 'hardware' }> = {
  kind: 'hardware',
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Cones',
  category: 'hardware',
  available_quantity: 12,
};

describe('Yard kiosk state', () => {
  it('keeps one direction and counterpart for the complete basket', () => {
    const directionState = yardKioskReducer(INITIAL_YARD_KIOSK_STATE, {
      type: 'SELECT_DIRECTION',
      direction: 'take',
    });
    const locationState = yardKioskReducer(directionState, {
      type: 'SELECT_LOCATION',
      location: {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Van AB12 CDE',
        description: null,
        location_type: 'van',
        external_reference: null,
      },
    });

    expect(locationState.phase).toBe('items');
    expect(locationState.direction).toBe('take');
    expect(locationState.counterpart?.name).toBe('Van AB12 CDE');
    expect(locationState.loadingStock).toBe(true);
  });

  it('adds serialized and bounded Hardware quantities to one basket', () => {
    let state = yardKioskReducer(INITIAL_YARD_KIOSK_STATE, {
      type: 'ADD_SERIALIZED',
      item: serializedItem,
    });
    state = yardKioskReducer(state, {
      type: 'SET_HARDWARE_QUANTITY',
      item: hardwareItem,
      quantity: 99,
    });

    expect(state.basket).toHaveLength(2);
    expect(state.basket.find((line) => line.kind === 'hardware')).toMatchObject({
      quantity: 12,
    });
    expect(getBasketSummary(state.basket)).toEqual({
      serialized: 1,
      hardwareLines: 1,
      hardwareUnits: 12,
    });
  });

  it('does not add a Yard-exit item whose check is blocked', () => {
    const state = yardKioskReducer(INITIAL_YARD_KIOSK_STATE, {
      type: 'ADD_SERIALIZED',
      item: {
        ...serializedItem,
        check_status: 'overdue',
        is_check_blocked: true,
      },
    });

    expect(state.basket).toHaveLength(0);
    expect(state.blockedItems).toEqual([
      expect.objectContaining({ item_number: 'TOOL-001', check_status: 'overdue' }),
    ]);
    expect(state.error).toContain('inventory check');
  });

  it('preserves the basket after a recoverable submission failure', () => {
    const withItem = yardKioskReducer(INITIAL_YARD_KIOSK_STATE, {
      type: 'ADD_SERIALIZED',
      item: serializedItem,
    });
    const submitting = yardKioskReducer(withItem, { type: 'SUBMIT_START' });
    const failed = yardKioskReducer(submitting, {
      type: 'SUBMIT_FAILED',
      message: 'Stock changed',
    });

    expect(failed.phase).toBe('items');
    expect(failed.basket).toEqual(withItem.basket);
    expect(failed.error).toBe('Stock changed');
  });
});
