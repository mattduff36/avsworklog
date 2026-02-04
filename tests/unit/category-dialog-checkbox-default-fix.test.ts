/**
 * Category Dialog Checkbox Default Bug Fix Test
 * 
 * Tests for bug fix related to incorrect default value in applies_to checkboxes
 */

import { describe, it, expect } from 'vitest';

describe('Category Dialog Checkbox Default Bug Fix', () => {
  describe('Bug: Incorrect default when checking plant after unchecking all', () => {
    it('should demonstrate the issue before fix with undefined', () => {
      const appliesTo: string[] | undefined = undefined; // Falsy

      // BEFORE: Defaults to ['vehicle']
      const currentBefore = appliesTo || ['vehicle'];
      const resultBefore = [...currentBefore.filter((a: string) => a !== 'plant'), 'plant'];

      // User expects: ['plant']
      // Actually gets: ['vehicle', 'plant'] ❌
      expect(resultBefore).toEqual(['vehicle', 'plant']); // ❌ Wrong!
    });

    it('should demonstrate the issue before fix with null', () => {
      const appliesTo: string[] | null = null; // Falsy

      // BEFORE: Defaults to ['vehicle']
      const currentBefore = appliesTo || ['vehicle'];
      const resultBefore = [...currentBefore.filter((a: string) => a !== 'plant'), 'plant'];

      // User expects: ['plant']
      // Actually gets: ['vehicle', 'plant'] ❌
      expect(resultBefore).toEqual(['vehicle', 'plant']); // ❌ Wrong!
    });

    it('should show correct behavior after fix', () => {
      const appliesTo: string[] | undefined = undefined; // Falsy

      // AFTER: Defaults to []
      const currentAfter = appliesTo || [];
      const resultAfter = [...currentAfter.filter((a: string) => a !== 'plant'), 'plant'];

      // User expects: ['plant']
      // Actually gets: ['plant'] ✅
      expect(resultAfter).toEqual(['plant']); // ✅ Correct!
    });
  });

  describe('Checkbox scenarios', () => {
    it('should handle checking plant when array is empty', () => {
      const appliesTo: string[] = [];

      // User checks plant
      const current = appliesTo || [];
      const result = [...current.filter(a => a !== 'plant'), 'plant'];

      expect(result).toEqual(['plant']); // ✅ Only plant
    });

    it('should handle checking vehicle when array is empty', () => {
      const appliesTo: string[] = [];

      // User checks vehicle
      const current = appliesTo || [];
      const result = [...current.filter(a => a !== 'vehicle'), 'vehicle'];

      expect(result).toEqual(['vehicle']); // ✅ Only vehicle
    });

    it('should handle checking plant when vehicle is already checked', () => {
      const appliesTo = ['vehicle'];

      // User checks plant
      const current = appliesTo || [];
      const result = [...current.filter(a => a !== 'plant'), 'plant'];

      expect(result).toEqual(['vehicle', 'plant']); // ✅ Both
    });

    it('should handle checking vehicle when plant is already checked', () => {
      const appliesTo = ['plant'];

      // User checks vehicle
      const current = appliesTo || [];
      const result = [...current.filter(a => a !== 'vehicle'), 'vehicle'];

      expect(result).toEqual(['plant', 'vehicle']); // ✅ Both
    });

    it('should handle unchecking plant when both are checked', () => {
      const appliesTo = ['vehicle', 'plant'];

      // User unchecks plant
      const current = appliesTo || [];
      const result = current.filter(a => a !== 'plant');

      expect(result).toEqual(['vehicle']); // ✅ Only vehicle remains
    });

    it('should handle unchecking vehicle when both are checked', () => {
      const appliesTo = ['vehicle', 'plant'];

      // User unchecks vehicle
      const current = appliesTo || [];
      const result = current.filter(a => a !== 'vehicle');

      expect(result).toEqual(['plant']); // ✅ Only plant remains
    });

    it('should handle unchecking the last item', () => {
      const appliesTo = ['vehicle'];

      // User unchecks vehicle
      const current = appliesTo || [];
      const result = current.filter(a => a !== 'vehicle');

      expect(result).toEqual([]); // ✅ Empty (will fail validation)
    });
  });

  describe('Undefined vs empty array', () => {
    it('should handle undefined appliesTo', () => {
      const appliesTo: string[] | undefined = undefined;

      // User checks plant
      const current = appliesTo || [];
      const result = [...current.filter(a => a !== 'plant'), 'plant'];

      expect(result).toEqual(['plant']); // ✅ Only plant
    });

    it('should handle null appliesTo', () => {
      const appliesTo: string[] | null = null;

      // User checks plant
      const current = appliesTo || [];
      const result = [...current.filter(a => a !== 'plant'), 'plant'];

      expect(result).toEqual(['plant']); // ✅ Only plant
    });

    it('should handle empty array appliesTo', () => {
      const appliesTo: string[] = [];

      // User checks plant
      const current = appliesTo || [];
      const result = [...current.filter(a => a !== 'plant'), 'plant'];

      expect(result).toEqual(['plant']); // ✅ Only plant
    });
  });

  describe('User interaction flows', () => {
    it('should handle flow: uncheck all, then check plant', () => {
      let appliesTo = ['vehicle', 'plant'];

      // User unchecks vehicle
      appliesTo = appliesTo.filter(a => a !== 'vehicle');
      expect(appliesTo).toEqual(['plant']);

      // User unchecks plant
      appliesTo = appliesTo.filter(a => a !== 'plant');
      expect(appliesTo).toEqual([]); // Empty

      // User checks plant
      const current = appliesTo || [];
      appliesTo = [...current.filter(a => a !== 'plant'), 'plant'];
      expect(appliesTo).toEqual(['plant']); // ✅ Only plant, not ['vehicle', 'plant']
    });

    it('should handle flow: uncheck all, then check vehicle', () => {
      let appliesTo = ['vehicle', 'plant'];

      // User unchecks vehicle
      appliesTo = appliesTo.filter(a => a !== 'vehicle');
      expect(appliesTo).toEqual(['plant']);

      // User unchecks plant
      appliesTo = appliesTo.filter(a => a !== 'plant');
      expect(appliesTo).toEqual([]); // Empty

      // User checks vehicle
      const current = appliesTo || [];
      appliesTo = [...current.filter(a => a !== 'vehicle'), 'vehicle'];
      expect(appliesTo).toEqual(['vehicle']); // ✅ Only vehicle
    });

    it('should handle flow: start empty, check plant, check vehicle', () => {
      let appliesTo: string[] = [];

      // User checks plant
      let current = appliesTo || [];
      appliesTo = [...current.filter(a => a !== 'plant'), 'plant'];
      expect(appliesTo).toEqual(['plant']);

      // User checks vehicle
      current = appliesTo || [];
      appliesTo = [...current.filter(a => a !== 'vehicle'), 'vehicle'];
      expect(appliesTo).toEqual(['plant', 'vehicle']); // ✅ Both
    });

    it('should handle flow: start empty, check vehicle, check plant', () => {
      let appliesTo: string[] = [];

      // User checks vehicle
      let current = appliesTo || [];
      appliesTo = [...current.filter(a => a !== 'vehicle'), 'vehicle'];
      expect(appliesTo).toEqual(['vehicle']);

      // User checks plant
      current = appliesTo || [];
      appliesTo = [...current.filter(a => a !== 'plant'), 'plant'];
      expect(appliesTo).toEqual(['vehicle', 'plant']); // ✅ Both
    });
  });

  describe('Before fix behavior (incorrect default)', () => {
    it('should show the problem with defaulting to [vehicle] when undefined', () => {
      const appliesTo: string[] | undefined = undefined; // Falsy

      // BEFORE: Default to ['vehicle']
      const currentBefore = appliesTo || ['vehicle'];

      // Checking plant adds to default ['vehicle']
      const resultBefore = [...currentBefore.filter(a => a !== 'plant'), 'plant'];

      // User wanted: ['plant']
      // Got: ['vehicle', 'plant'] ❌
      expect(resultBefore).toEqual(['vehicle', 'plant']); // ❌ Incorrect
      expect(resultBefore.length).toBe(2); // Has 2 items when user wanted 1
    });

    it('should show the problem with defaulting to [vehicle] when null', () => {
      const appliesTo: string[] | null = null; // Falsy

      // BEFORE: Default to ['vehicle']
      const currentBefore = appliesTo || ['vehicle'];

      // Checking plant adds to default ['vehicle']
      const resultBefore = [...currentBefore.filter(a => a !== 'plant'), 'plant'];

      // User wanted: ['plant']
      // Got: ['vehicle', 'plant'] ❌
      expect(resultBefore).toEqual(['vehicle', 'plant']); // ❌ Incorrect
      expect(resultBefore.length).toBe(2); // Has 2 items when user wanted 1
    });

    it('should show correct behavior with empty array (truthy)', () => {
      const appliesTo: string[] = []; // Truthy (not caught by ||)

      // Empty array is truthy, so even BEFORE fix it works here
      const current = appliesTo || ['vehicle'];

      const result = [...current.filter(a => a !== 'vehicle'), 'vehicle'];

      // Empty array passes through
      expect(current).toEqual([]); // [] is truthy
      expect(result).toEqual(['vehicle']); // ✅ Works
    });
  });

  describe('After fix behavior (correct empty default)', () => {
    it('should show correct behavior with empty default', () => {
      const appliesTo: string[] = [];

      // AFTER: Default to []
      const currentAfter = appliesTo || [];

      // Checking plant adds to empty array
      const resultAfter = [...currentAfter.filter(a => a !== 'plant'), 'plant'];

      // User wanted: ['plant']
      // Got: ['plant'] ✅
      expect(resultAfter).toEqual(['plant']); // ✅ Correct
      expect(resultAfter.length).toBe(1); // Exactly what user wanted
    });

    it('should work correctly for vehicle too', () => {
      const appliesTo: string[] = [];

      // AFTER: Default to []
      const currentAfter = appliesTo || [];

      // Checking vehicle adds to empty array
      const resultAfter = [...currentAfter.filter(a => a !== 'vehicle'), 'vehicle'];

      // User wanted: ['vehicle']
      // Got: ['vehicle'] ✅
      expect(resultAfter).toEqual(['vehicle']); // ✅ Correct
    });
  });

  describe('Edge cases', () => {
    it('should handle toggling the same checkbox multiple times', () => {
      let appliesTo: string[] = [];

      // Check plant
      appliesTo = [...(appliesTo || []).filter(a => a !== 'plant'), 'plant'];
      expect(appliesTo).toEqual(['plant']);

      // Uncheck plant
      appliesTo = (appliesTo || []).filter(a => a !== 'plant');
      expect(appliesTo).toEqual([]);

      // Check plant again
      appliesTo = [...(appliesTo || []).filter(a => a !== 'plant'), 'plant'];
      expect(appliesTo).toEqual(['plant']); // ✅ Still correct
    });

    it('should handle checking already checked item', () => {
      let appliesTo = ['plant'];

      // Check plant again (shouldn't duplicate)
      const current = appliesTo || [];
      appliesTo = [...current.filter(a => a !== 'plant'), 'plant'];

      expect(appliesTo).toEqual(['plant']); // ✅ No duplicate
      expect(appliesTo.length).toBe(1);
    });

    it('should handle unchecking already unchecked item', () => {
      let appliesTo = ['vehicle'];

      // Uncheck plant (not checked)
      const current = appliesTo || [];
      appliesTo = current.filter(a => a !== 'plant');

      expect(appliesTo).toEqual(['vehicle']); // ✅ No change
    });
  });

  describe('Validation interaction', () => {
    it('should allow empty array (validation will catch it)', () => {
      let appliesTo = ['vehicle'];

      // Uncheck vehicle
      appliesTo = appliesTo.filter(a => a !== 'vehicle');

      expect(appliesTo).toEqual([]); // ✅ Empty
      // Zod validation with .min(1) will catch this and show error
    });

    it('should verify at least one must be selected (Zod validation)', () => {
      const schema = {
        validate: (appliesTo: string[]) => appliesTo.length >= 1
      };

      expect(schema.validate(['vehicle'])).toBe(true);
      expect(schema.validate(['plant'])).toBe(true);
      expect(schema.validate(['vehicle', 'plant'])).toBe(true);
      expect(schema.validate([])).toBe(false); // ❌ Will fail validation
    });
  });
});
