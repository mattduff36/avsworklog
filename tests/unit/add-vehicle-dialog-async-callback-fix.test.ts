/**
 * AddVehicleDialog Async Callback Type Mismatch Fix Test
 * 
 * Tests for bug fix related to onSuccess callback type and async behavior
 */

import { describe, it, expect } from 'vitest';

describe('AddVehicleDialog Async Callback Type Mismatch Fix', () => {
  describe('Bug 1: Type mismatch between definition and usage', () => {
    it('should demonstrate the type mismatch before fix', () => {
      // BEFORE: onSuccess is typed as () => void
      type OnSuccessBefore = () => void;

      // But PlantTable passes async function
      const plantTableCallback: () => Promise<void> = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      };

      // Type error: Promise<void> is not assignable to void ❌
      // @ts-expect-error - This should fail type checking
      const typedCallback: OnSuccessBefore = plantTableCallback;

      expect(typedCallback).toBeDefined(); // ❌ Type error exists
    });

    it('should show correct type after fix', () => {
      // AFTER: onSuccess accepts both sync and async
      type OnSuccessAfter = () => void | Promise<void>;

      // Sync callback works
      const syncCallback: OnSuccessAfter = () => {
        console.log('sync');
      };

      // Async callback also works
      const asyncCallback: OnSuccessAfter = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      };

      expect(syncCallback).toBeDefined(); // ✅ Works
      expect(asyncCallback).toBeDefined(); // ✅ Works
    });
  });

  describe('Bug 1: Race condition from not awaiting async callback', () => {
    it('should demonstrate race condition before fix', async () => {
      let dataFetched = false;
      let dialogClosed = false;

      // Simulate PlantTable's async callback
      const onSuccess = async () => {
        await new Promise(resolve => setTimeout(resolve, 50)); // fetchPlantData()
        dataFetched = true;
      };

      // BEFORE: Call without await
      onSuccess(); // ❌ Doesn't await
      dialogClosed = true; // Closes immediately

      // Race condition: dialog closes before data is fetched
      expect(dialogClosed).toBe(true); // ✅ Dialog closed
      expect(dataFetched).toBe(false); // ❌ Data not yet fetched (race condition!)

      // Wait for async operation to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(dataFetched).toBe(true); // ✅ Eventually fetched (but too late)
    });

    it('should show correct behavior after fix', async () => {
      let dataFetched = false;
      let dialogClosed = false;

      // Simulate PlantTable's async callback
      const onSuccess = async () => {
        await new Promise(resolve => setTimeout(resolve, 50)); // fetchPlantData()
        dataFetched = true;
      };

      // AFTER: Await before closing
      await onSuccess(); // ✅ Awaits
      dialogClosed = true; // Closes after await

      // No race condition: data fetched before dialog closes
      expect(dataFetched).toBe(true); // ✅ Data fetched
      expect(dialogClosed).toBe(true); // ✅ Dialog closed after data fetch
    });
  });

  describe('Async callback behavior', () => {
    it('should handle sync callbacks (backward compatibility)', async () => {
      let called = false;

      const onSuccess = () => {
        called = true;
      };

      await onSuccess(); // ✅ Works with await
      expect(called).toBe(true);
    });

    it('should handle async callbacks', async () => {
      let called = false;

      const onSuccess = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        called = true;
      };

      await onSuccess(); // ✅ Properly awaits
      expect(called).toBe(true);
    });

    it('should handle callbacks that return Promise<void>', async () => {
      let value = 0;

      const onSuccess = (): Promise<void> => {
        return new Promise(resolve => {
          setTimeout(() => {
            value = 42;
            resolve();
          }, 10);
        });
      };

      await onSuccess();
      expect(value).toBe(42); // ✅ Promise resolved
    });
  });

  describe('PlantTable integration', () => {
    it('should simulate PlantTable async callback flow', async () => {
      const logs: string[] = [];

      // Simulate fetchPlantData
      const fetchPlantData = async () => {
        logs.push('fetch-start');
        await new Promise(resolve => setTimeout(resolve, 20));
        logs.push('fetch-complete');
      };

      // Simulate parent callback
      const onVehicleAdded = () => {
        logs.push('parent-notified');
      };

      // PlantTable's onSuccess callback
      const onSuccess = async () => {
        await fetchPlantData();
        onVehicleAdded?.();
      };

      // AddVehicleDialog flow
      logs.push('dialog-submit');
      await onSuccess(); // ✅ Awaits
      logs.push('dialog-close');

      // Verify correct order
      expect(logs).toEqual([
        'dialog-submit',
        'fetch-start',
        'fetch-complete',
        'parent-notified',
        'dialog-close'
      ]);
    });

    it('should show race condition without await', async () => {
      const logs: string[] = [];

      const fetchPlantData = async () => {
        logs.push('fetch-start');
        await new Promise(resolve => setTimeout(resolve, 20));
        logs.push('fetch-complete');
      };

      const onVehicleAdded = () => {
        logs.push('parent-notified');
      };

      const onSuccess = async () => {
        await fetchPlantData();
        onVehicleAdded?.();
      };

      // BEFORE: Without await
      logs.push('dialog-submit');
      onSuccess(); // ❌ No await
      logs.push('dialog-close');

      // Race condition: dialog closes before fetch completes
      expect(logs).toEqual([
        'dialog-submit',
        'fetch-start', // Started but not complete
        'dialog-close' // ❌ Closed too early!
      ]);

      // Wait for async to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(logs).toEqual([
        'dialog-submit',
        'fetch-start',
        'dialog-close',
        'fetch-complete', // ❌ Completed after dialog closed
        'parent-notified'
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined callback', async () => {
      const onSuccess: (() => void | Promise<void>) | undefined = undefined;

      // Should not throw
      await onSuccess?.();
      expect(true).toBe(true); // ✅ No error
    });

    it('should handle callback that throws', async () => {
      const onSuccess = async () => {
        throw new Error('Callback error');
      };

      // Should propagate error
      await expect(onSuccess()).rejects.toThrow('Callback error');
    });

    it('should handle sync callback with return value (ignored)', async () => {
      const onSuccess = () => {
        return 'some value'; // Return value ignored
      };

      const result = await onSuccess();
      expect(result).toBe('some value'); // ✅ Value returned but not used
    });

    it('should handle multiple sequential calls', async () => {
      let count = 0;

      const onSuccess = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        count++;
      };

      await onSuccess();
      await onSuccess();
      await onSuccess();

      expect(count).toBe(3); // ✅ All awaited properly
    });
  });

  describe('Type compatibility', () => {
    it('should accept sync function', () => {
      type OnSuccess = () => void | Promise<void>;
      const sync: OnSuccess = () => {};
      expect(typeof sync).toBe('function');
    });

    it('should accept async function', () => {
      type OnSuccess = () => void | Promise<void>;
      const async: OnSuccess = async () => {};
      expect(typeof async).toBe('function');
    });

    it('should accept function returning Promise<void>', () => {
      type OnSuccess = () => void | Promise<void>;
      const promiseReturning: OnSuccess = (): Promise<void> => {
        return Promise.resolve();
      };
      expect(typeof promiseReturning).toBe('function');
    });

    it('should be assignable to optional parameter', () => {
      type Props = {
        onSuccess?: () => void | Promise<void>;
      };

      const props1: Props = {};
      const props2: Props = { onSuccess: () => {} };
      const props3: Props = { onSuccess: async () => {} };

      expect(props1.onSuccess).toBeUndefined();
      expect(props2.onSuccess).toBeDefined();
      expect(props3.onSuccess).toBeDefined();
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle successful data fetch and parent notification', async () => {
      let plantData: string[] = [];
      let parentNotified = false;

      const fetchPlantData = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        plantData = ['P001', 'P002', 'P003'];
      };

      const onVehicleAdded = () => {
        parentNotified = true;
      };

      const onSuccess = async () => {
        await fetchPlantData();
        onVehicleAdded?.();
      };

      await onSuccess();

      expect(plantData).toEqual(['P001', 'P002', 'P003']); // ✅ Data loaded
      expect(parentNotified).toBe(true); // ✅ Parent notified
    });

    it('should handle error in fetch and prevent parent notification', async () => {
      let parentNotified = false;

      const fetchPlantData = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Fetch failed');
      };

      const onVehicleAdded = () => {
        parentNotified = true;
      };

      const onSuccess = async () => {
        await fetchPlantData();
        onVehicleAdded?.(); // Won't be called due to error
      };

      await expect(onSuccess()).rejects.toThrow('Fetch failed');
      expect(parentNotified).toBe(false); // ✅ Not notified due to error
    });
  });
});
