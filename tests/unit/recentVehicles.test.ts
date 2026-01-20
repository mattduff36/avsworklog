import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getRecentVehicleIds,
  recordRecentVehicleId,
  clearRecentVehicles,
  splitVehiclesByRecent,
} from '@/lib/utils/recentVehicles';

describe('Recent Vehicles Utility', () => {
  const testUserId = 'user-123';
  const storageKey = `recent_vehicles_${testUserId}`;

  // Create a fresh store for each test
  let store: Record<string, string> = {};
  
  const localStorageMock = {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };

  // Store original window
  const originalWindow = global.window;

  beforeEach(() => {
    // Reset store and mocks
    store = {};
    vi.clearAllMocks();
    
    // Mock window and localStorage for Node environment
    // @ts-expect-error - mocking global window
    global.window = { localStorage: localStorageMock };
    // @ts-expect-error - also mock global localStorage
    global.localStorage = localStorageMock;
  });

  afterEach(() => {
    // Restore original window
    global.window = originalWindow;
  });

  describe('getRecentVehicleIds', () => {
    it('should return empty array for empty userId', () => {
      expect(getRecentVehicleIds('')).toEqual([]);
    });

    it('should return empty array when no data exists', () => {
      expect(getRecentVehicleIds(testUserId)).toEqual([]);
    });

    it('should return stored vehicle IDs', () => {
      // Set data directly in store (simulating prior localStorage state)
      store[storageKey] = JSON.stringify(['v1', 'v2', 'v3']);
      expect(getRecentVehicleIds(testUserId)).toEqual(['v1', 'v2', 'v3']);
    });

    it('should handle invalid JSON gracefully', () => {
      store[storageKey] = 'invalid json';
      expect(getRecentVehicleIds(testUserId)).toEqual([]);
    });

    it('should filter out non-string values', () => {
      store[storageKey] = JSON.stringify(['v1', null, 123, 'v2', '']);
      expect(getRecentVehicleIds(testUserId)).toEqual(['v1', 'v2']);
    });

    it('should limit to max 3 entries', () => {
      store[storageKey] = JSON.stringify(['v1', 'v2', 'v3', 'v4', 'v5']);
      expect(getRecentVehicleIds(testUserId)).toEqual(['v1', 'v2', 'v3']);
    });
  });

  describe('recordRecentVehicleId', () => {
    it('should return empty array for empty userId', () => {
      expect(recordRecentVehicleId('', 'v1')).toEqual([]);
    });

    it('should return current list for empty vehicleId', () => {
      store[storageKey] = JSON.stringify(['v1']);
      expect(recordRecentVehicleId(testUserId, '')).toEqual(['v1']);
    });

    it('should add vehicle to empty list', () => {
      const result = recordRecentVehicleId(testUserId, 'v1');
      expect(result).toEqual(['v1']);
      expect(JSON.parse(store[storageKey])).toEqual(['v1']);
    });

    it('should add vehicle to front of list', () => {
      store[storageKey] = JSON.stringify(['v1', 'v2']);
      const result = recordRecentVehicleId(testUserId, 'v3');
      expect(result).toEqual(['v3', 'v1', 'v2']);
    });

    it('should move existing vehicle to front (dedupe)', () => {
      store[storageKey] = JSON.stringify(['v1', 'v2', 'v3']);
      const result = recordRecentVehicleId(testUserId, 'v2');
      expect(result).toEqual(['v2', 'v1', 'v3']);
    });

    it('should limit to max 3 entries by default', () => {
      store[storageKey] = JSON.stringify(['v1', 'v2', 'v3']);
      const result = recordRecentVehicleId(testUserId, 'v4');
      expect(result).toEqual(['v4', 'v1', 'v2']);
      expect(result).toHaveLength(3);
    });

    it('should respect custom max parameter', () => {
      store[storageKey] = JSON.stringify(['v1', 'v2']);
      const result = recordRecentVehicleId(testUserId, 'v3', 2);
      expect(result).toEqual(['v3', 'v1']);
      expect(result).toHaveLength(2);
    });
  });

  describe('clearRecentVehicles', () => {
    it('should clear recent vehicles for user', () => {
      store[storageKey] = JSON.stringify(['v1', 'v2']);
      clearRecentVehicles(testUserId);
      expect(store[storageKey]).toBeUndefined();
    });

    it('should handle empty userId', () => {
      clearRecentVehicles('');
      // No change since userId is empty
      expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    });
  });

  describe('splitVehiclesByRecent', () => {
    const vehicles = [
      { id: 'v1', reg_number: 'ABC 123' },
      { id: 'v2', reg_number: 'DEF 456' },
      { id: 'v3', reg_number: 'GHI 789' },
      { id: 'v4', reg_number: 'JKL 012' },
    ];

    it('should return all vehicles as other when no recents', () => {
      const result = splitVehiclesByRecent(vehicles, []);
      expect(result.recentVehicles).toEqual([]);
      expect(result.otherVehicles).toEqual(vehicles);
    });

    it('should split vehicles correctly', () => {
      const result = splitVehiclesByRecent(vehicles, ['v2', 'v4']);
      
      expect(result.recentVehicles).toHaveLength(2);
      expect(result.recentVehicles[0].id).toBe('v2');
      expect(result.recentVehicles[1].id).toBe('v4');
      
      expect(result.otherVehicles).toHaveLength(2);
      expect(result.otherVehicles.map(v => v.id)).toEqual(['v1', 'v3']);
    });

    it('should maintain order of recent IDs', () => {
      const result = splitVehiclesByRecent(vehicles, ['v3', 'v1', 'v4']);
      
      expect(result.recentVehicles.map(v => v.id)).toEqual(['v3', 'v1', 'v4']);
    });

    it('should ignore recent IDs not in vehicles list', () => {
      const result = splitVehiclesByRecent(vehicles, ['v2', 'v-nonexistent', 'v4']);
      
      expect(result.recentVehicles).toHaveLength(2);
      expect(result.recentVehicles.map(v => v.id)).toEqual(['v2', 'v4']);
    });

    it('should handle empty vehicles list', () => {
      const result = splitVehiclesByRecent([], ['v1', 'v2']);
      expect(result.recentVehicles).toEqual([]);
      expect(result.otherVehicles).toEqual([]);
    });
  });
});
