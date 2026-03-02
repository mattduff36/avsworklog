/**
 * CategoryDialog Zod Validation Error Path Fix Test
 * 
 * Tests for bug fix related to dynamic error path in .refine() based on category type
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Simulate the schema structure
const createCategorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['date', 'mileage', 'hours']),
  alert_threshold_days: z.number().optional(),
  alert_threshold_miles: z.number().optional(),
  alert_threshold_hours: z.number().optional(),
});

// BEFORE: Hardcoded error path
const schemaBefore = createCategorySchema.refine(
  (data) => {
    if (data.type === 'date') {
      return data.alert_threshold_days != null && data.alert_threshold_days > 0;
    }
    if (data.type === 'mileage') {
      return data.alert_threshold_miles != null && data.alert_threshold_miles > 0;
    }
    if (data.type === 'hours') {
      return data.alert_threshold_hours != null && data.alert_threshold_hours > 0;
    }
    return true;
  },
  {
    message: 'Threshold required',
    path: ['alert_threshold_days'] // ❌ Always days, regardless of type
  }
);

// AFTER: Dynamic error path using superRefine
const schemaAfter = createCategorySchema.superRefine((data, ctx) => {
  // ✅ Use superRefine for dynamic error paths
  if (data.type === 'date') {
    if (data.alert_threshold_days == null || data.alert_threshold_days <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Threshold required',
        path: ['alert_threshold_days']
      });
    }
  } else if (data.type === 'mileage') {
    if (data.alert_threshold_miles == null || data.alert_threshold_miles <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Threshold required',
        path: ['alert_threshold_miles']
      });
    }
  } else if (data.type === 'hours') {
    if (data.alert_threshold_hours == null || data.alert_threshold_hours <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Threshold required',
        path: ['alert_threshold_hours']
      });
    }
  }
});

describe('CategoryDialog Zod Validation Error Path Fix', () => {
  describe('Bug 2: Hardcoded error path regardless of type', () => {
    it('should show error on wrong field for mileage category (before fix)', () => {
      const data = {
        name: 'Oil Change',
        type: 'mileage' as const,
        // Missing alert_threshold_miles
      };

      const result = schemaBefore.safeParse(data);

      expect(result.success).toBe(false);
      if (!result.success) {
        // Error is on wrong field!
        const errorPath = result.error.issues[0]?.path[0];
        expect(errorPath).toBe('alert_threshold_days'); // ❌ Wrong field!
        
        // User won't see error because UI checks errors.alert_threshold_miles
        // But error is stored in errors.alert_threshold_days
      }
    });

    it('should show error on correct field for mileage category (after fix)', () => {
      const data = {
        name: 'Oil Change',
        type: 'mileage' as const,
        // Missing alert_threshold_miles
      };

      const result = schemaAfter.safeParse(data);

      expect(result.success).toBe(false);
      if (!result.success) {
        // Debug: Log the error structure
        console.log('Error issues:', JSON.stringify(result.error.issues, null, 2));
        
        // Error is on correct field!
        const errorPath = result.error.issues[0]?.path[0];
        expect(errorPath).toBe('alert_threshold_miles'); // ✅ Correct field!
      }
    });

    it('should show error on wrong field for hours category (before fix)', () => {
      const data = {
        name: 'LOLER Inspection',
        type: 'hours' as const,
        // Missing alert_threshold_hours
      };

      const result = schemaBefore.safeParse(data);

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorPath = result.error.issues[0]?.path[0];
        expect(errorPath).toBe('alert_threshold_days'); // ❌ Wrong field!
      }
    });

    it('should show error on correct field for hours category (after fix)', () => {
      const data = {
        name: 'LOLER Inspection',
        type: 'hours' as const,
        // Missing alert_threshold_hours
      };

      const result = schemaAfter.safeParse(data);

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorPath = result.error.issues[0]?.path[0];
        expect(errorPath).toBe('alert_threshold_hours'); // ✅ Correct field!
      }
    });

    it('should show error on correct field for date category (both work)', () => {
      const data = {
        name: 'MOT',
        type: 'date' as const,
        // Missing alert_threshold_days
      };

      const resultBefore = schemaBefore.safeParse(data);
      const resultAfter = schemaAfter.safeParse(data);

      expect(resultBefore.success).toBe(false);
      expect(resultAfter.success).toBe(false);

      if (!resultBefore.success && !resultAfter.success) {
        const pathBefore = resultBefore.error.issues[0]?.path[0];
        const pathAfter = resultAfter.error.issues[0]?.path[0];
        
        // Both correct for date type
        expect(pathBefore).toBe('alert_threshold_days'); // ✅ Correct (by luck)
        expect(pathAfter).toBe('alert_threshold_days'); // ✅ Correct (by design)
      }
    });
  });

  describe('Validation passes when threshold is provided', () => {
    it('should pass validation for date category with days threshold', () => {
      const data = {
        name: 'MOT',
        type: 'date' as const,
        alert_threshold_days: 30
      };

      const result = schemaAfter.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should pass validation for mileage category with miles threshold', () => {
      const data = {
        name: 'Oil Change',
        type: 'mileage' as const,
        alert_threshold_miles: 1000
      };

      const result = schemaAfter.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should pass validation for hours category with hours threshold', () => {
      const data = {
        name: 'LOLER Inspection',
        type: 'hours' as const,
        alert_threshold_hours: 100
      };

      const result = schemaAfter.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('Validation fails when threshold is missing', () => {
    it('should fail for date category without days threshold', () => {
      const data = {
        name: 'MOT',
        type: 'date' as const
      };

      const result = schemaAfter.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('alert_threshold_days');
      }
    });

    it('should fail for mileage category without miles threshold', () => {
      const data = {
        name: 'Oil Change',
        type: 'mileage' as const
      };

      const result = schemaAfter.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('alert_threshold_miles');
      }
    });

    it('should fail for hours category without hours threshold', () => {
      const data = {
        name: 'LOLER Inspection',
        type: 'hours' as const
      };

      const result = schemaAfter.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path[0]).toBe('alert_threshold_hours');
      }
    });
  });

  describe('Validation fails when threshold is zero or negative', () => {
    it('should fail for date category with zero days', () => {
      const data = {
        name: 'MOT',
        type: 'date' as const,
        alert_threshold_days: 0
      };

      const result = schemaAfter.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should fail for mileage category with zero miles', () => {
      const data = {
        name: 'Oil Change',
        type: 'mileage' as const,
        alert_threshold_miles: 0
      };

      const result = schemaAfter.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should fail for hours category with negative hours', () => {
      const data = {
        name: 'LOLER Inspection',
        type: 'hours' as const,
        alert_threshold_hours: -10
      };

      const result = schemaAfter.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('UI error display impact', () => {
    it('should demonstrate error not showing in UI before fix', () => {
      // User creates mileage category without miles threshold
      const formData = {
        name: 'Oil Change',
        type: 'mileage' as const
      };

      const result = schemaBefore.safeParse(formData);
      
      if (!result.success) {
        const errors: Record<string, { message: string }> = {};
        result.error.issues.forEach(issue => {
          const path = issue.path[0] as string;
          errors[path] = { message: issue.message };
        });

        // UI checks: errors.alert_threshold_miles
        const uiError = errors.alert_threshold_miles;
        expect(uiError).toBeUndefined(); // ❌ Error not found!

        // Error is actually in: errors.alert_threshold_days
        const actualError = errors.alert_threshold_days;
        expect(actualError).toBeDefined(); // ✅ Error exists but in wrong place
        expect(actualError?.message).toBe('Threshold required');
      }
    });

    it('should demonstrate error correctly showing in UI after fix', () => {
      // User creates mileage category without miles threshold
      const formData = {
        name: 'Oil Change',
        type: 'mileage' as const
      };

      const result = schemaAfter.safeParse(formData);
      
      if (!result.success) {
        const errors: Record<string, { message: string }> = {};
        result.error.issues.forEach(issue => {
          const path = issue.path[0] as string;
          errors[path] = { message: issue.message };
        });

        // UI checks: errors.alert_threshold_miles
        const uiError = errors.alert_threshold_miles;
        expect(uiError).toBeDefined(); // ✅ Error found!
        expect(uiError?.message).toBe('Threshold required');

        // No error in wrong place
        const wrongPlaceError = errors.alert_threshold_days;
        expect(wrongPlaceError).toBeUndefined(); // ✅ No error here
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle all three types correctly', () => {
      const testCases = [
        { type: 'date' as const, expectedPath: 'alert_threshold_days' },
        { type: 'mileage' as const, expectedPath: 'alert_threshold_miles' },
        { type: 'hours' as const, expectedPath: 'alert_threshold_hours' }
      ];

      testCases.forEach(({ type, expectedPath }) => {
        const data = {
          name: 'Test',
          type
        };

        const result = schemaAfter.safeParse(data);
        expect(result.success).toBe(false);
        
        if (!result.success) {
          const actualPath = result.error.issues[0]?.path[0];
          expect(actualPath).toBe(expectedPath);
        }
      });
    });

    it('should handle valid data for all types', () => {
      const validData = [
        { name: 'Test', type: 'date' as const, alert_threshold_days: 30 },
        { name: 'Test', type: 'mileage' as const, alert_threshold_miles: 1000 },
        { name: 'Test', type: 'hours' as const, alert_threshold_hours: 100 }
      ];

      validData.forEach(data => {
        const result = schemaAfter.safeParse(data);
        expect(result.success).toBe(true);
      });
    });
  });
});
