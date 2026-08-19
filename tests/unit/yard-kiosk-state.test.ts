import { describe, expect, it } from 'vitest';
import {
  INITIAL_YARD_KIOSK_STATE,
  getBasketSummary,
  getYardKioskGuidance,
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
  check_warning_required: false,
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
        source_type: null,
        external_reference: null,
        primary_user_names: [],
        secondary_user_names: [],
      },
    });

    expect(locationState.phase).toBe('items');
    expect(locationState.direction).toBe('take');
    expect(locationState.counterpart?.name).toBe('Van AB12 CDE');
    expect(locationState.loadingStock).toBe(true);
  });

  it('keeps typed Collect details without inventing a counterpart', () => {
    const directionState = yardKioskReducer(INITIAL_YARD_KIOSK_STATE, {
      type: 'SELECT_DIRECTION',
      direction: 'take',
    });
    const unallocatedState = yardKioskReducer(directionState, {
      type: 'SELECT_UNALLOCATED_LOCATION',
      details: 'Job van, not on the list',
    });

    expect(unallocatedState.phase).toBe('items');
    expect(unallocatedState.counterpart).toBeNull();
    expect(unallocatedState.unallocatedDetails).toBe('Job van, not on the list');
    expect(unallocatedState.loadingStock).toBe(true);
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

  it('round-trips reducer state through the remote snapshot JSON format', () => {
    const withSerialized = yardKioskReducer(INITIAL_YARD_KIOSK_STATE, {
      type: 'ADD_SERIALIZED',
      item: serializedItem,
    });
    const restored = JSON.parse(JSON.stringify(withSerialized)) as typeof withSerialized;
    const next = yardKioskReducer(restored, {
      type: 'SET_HARDWARE_QUANTITY',
      item: hardwareItem,
      quantity: 3,
    });

    expect(restored).toEqual(withSerialized);
    expect(next.basket).toEqual([
      ...withSerialized.basket,
      expect.objectContaining({
        kind: 'hardware',
        item_id: hardwareItem.id,
        quantity: 3,
      }),
    ]);
  });

  it('adds a Yard-exit warning item and retains its check marker', () => {
    const state = yardKioskReducer(INITIAL_YARD_KIOSK_STATE, {
      type: 'ADD_SERIALIZED',
      item: {
        ...serializedItem,
        check_status: 'overdue',
        check_warning_required: true,
      },
    });

    expect(state.basket).toEqual([
      expect.objectContaining({
        item_number: 'TOOL-001',
        check_status: 'overdue',
        check_warning_required: true,
      }),
    ]);
    expect(state.error).toBeNull();
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

  it('fully discards partial workflow and receipt state on reset', () => {
    const reset = yardKioskReducer({
      ...INITIAL_YARD_KIOSK_STATE,
      phase: 'receipt',
      direction: 'take',
      counterpart: {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Van AB12 CDE',
        description: null,
        location_type: 'van',
        source_type: null,
        external_reference: null,
        primary_user_names: [],
        secondary_user_names: [],
      },
      stock: [serializedItem],
      basket: [{
        kind: 'serialized',
        item_id: serializedItem.id,
        item_number: serializedItem.item_number,
        name: serializedItem.name,
        category: serializedItem.category,
        check_status: serializedItem.check_status,
        check_warning_required: serializedItem.check_warning_required,
      }],
      searchQuery: 'breaker',
      category: 'tools',
      loadingStock: true,
      error: 'Draft error',
      receipt: {
        kiosk_batch_id: 'batch-one',
        movement_batch_id: 'movement-one',
        hardware_batch_id: null,
        serialized_count: 1,
        hardware_line_count: 0,
      },
    }, { type: 'RESET' });

    expect(reset).toEqual(INITIAL_YARD_KIOSK_STATE);
  });

  it('provides action guidance only until the basket is confirmed', () => {
    expect(getYardKioskGuidance(INITIAL_YARD_KIOSK_STATE)).toMatchObject({
      instructionKey: null,
      message: null,
      stepLabel: 'Choose direction',
    });
    expect(getYardKioskGuidance({
      ...INITIAL_YARD_KIOSK_STATE,
      phase: 'location',
      direction: 'take',
    }).message).toBe('Select the destination, or type the location details');
    expect(getYardKioskGuidance({
      ...INITIAL_YARD_KIOSK_STATE,
      phase: 'location',
      direction: 'return',
    }).message).toBe('Select the source location');
    expect(getYardKioskGuidance({
      ...INITIAL_YARD_KIOSK_STATE,
      phase: 'items',
      direction: 'take',
    }).message).toBe('Select stock to collect from Yard');
    expect(getYardKioskGuidance({
      ...INITIAL_YARD_KIOSK_STATE,
      phase: 'items',
      direction: 'return',
    }).message).toBe('Select stock to return to Yard');
    expect(getYardKioskGuidance({
      ...INITIAL_YARD_KIOSK_STATE,
      phase: 'items',
      direction: 'take',
      basket: [{
        kind: 'serialized',
        item_id: serializedItem.id,
        item_number: serializedItem.item_number,
        name: serializedItem.name,
        category: serializedItem.category,
        check_status: serializedItem.check_status,
        check_warning_required: serializedItem.check_warning_required,
      }],
    }).message).toBe('Review your basket, then confirm');
    expect(getYardKioskGuidance({
      ...INITIAL_YARD_KIOSK_STATE,
      phase: 'submitting',
      direction: 'take',
      counterpart: {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Van AB12 CDE',
        description: null,
        location_type: 'van',
        source_type: null,
        external_reference: null,
        primary_user_names: [],
        secondary_user_names: [],
      },
    })).toMatchObject({
      instructionKey: null,
      message: null,
      stepLabel: 'Confirming transfer',
    });
    expect(getYardKioskGuidance({
      ...INITIAL_YARD_KIOSK_STATE,
      phase: 'submitting',
      direction: 'return',
    })).toMatchObject({
      instructionKey: null,
      message: null,
      stepLabel: 'Confirming transfer',
    });
    expect(getYardKioskGuidance({
      ...INITIAL_YARD_KIOSK_STATE,
      phase: 'receipt',
      direction: 'take',
    })).toMatchObject({
      instructionKey: null,
      message: null,
      stepLabel: 'Complete',
    });
  });
});
