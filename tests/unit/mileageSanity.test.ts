import { describe, it, expect } from 'vitest';
import { 
  checkMileageSanity, 
  formatMileage, 
  MILEAGE_SANITY_CONFIG 
} from '@/lib/utils/mileageSanity';

describe('Mileage Sanity Check', () => {
  describe('checkMileageSanity', () => {
    it('should accept valid mileage when no baseline exists', () => {
      const result = checkMileageSanity(50000, null);
      expect(result.isValid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('should accept valid mileage with small increase', () => {
      const result = checkMileageSanity(51000, 50000);
      expect(result.isValid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('should accept valid mileage with small decrease (within threshold)', () => {
      // Small decrease is acceptable (e.g., different odometer reading)
      const result = checkMileageSanity(49500, 50000);
      expect(result.isValid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('should warn when mileage decreases significantly', () => {
      // Decrease > 1000 miles triggers warning
      const result = checkMileageSanity(45000, 50000);
      expect(result.isValid).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warningType).toBe('decrease');
      expect(result.warning).toContain('lower');
    });

    it('should warn when mileage increases significantly', () => {
      // Increase > 5000 miles triggers warning
      const result = checkMileageSanity(60000, 50000);
      expect(result.isValid).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warningType).toBe('large_increase');
      expect(result.warning).toContain('higher');
    });

    it('should warn when mileage doubles for low-mileage vehicles', () => {
      // For vehicles under 100k, doubling the mileage triggers warning
      const result = checkMileageSanity(50000, 20000);
      expect(result.isValid).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warningType).toBe('large_increase');
      expect(result.warning).toContain('double');
    });

    it('should not warn about doubling for high-mileage vehicles', () => {
      // For vehicles over 100k, doubling check is not applied
      const result = checkMileageSanity(120000, 115000);
      expect(result.isValid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('should reject negative mileage', () => {
      const result = checkMileageSanity(-1000, 50000);
      expect(result.isValid).toBe(false);
      expect(result.warning).toContain('negative');
    });

    it('should handle zero mileage', () => {
      const result = checkMileageSanity(0, null);
      expect(result.isValid).toBe(true);
    });

    it('should handle edge case at exact threshold', () => {
      // Exactly 1000 miles decrease should not warn
      const result = checkMileageSanity(49000, 50000);
      expect(result.isValid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('should handle edge case just over threshold', () => {
      // 1001 miles decrease should warn
      const result = checkMileageSanity(48999, 50000);
      expect(result.isValid).toBe(true);
      expect(result.warning).toBeDefined();
    });

    it('should include formatted numbers in warning message', () => {
      const result = checkMileageSanity(250000, 24800);
      expect(result.warning).toContain('250,000');
      expect(result.warning).toContain('24,800');
    });
  });

  describe('formatMileage', () => {
    it('should format mileage with thousands separator', () => {
      expect(formatMileage(50000)).toBe('50,000 miles');
    });

    it('should return "Unknown" for null', () => {
      expect(formatMileage(null)).toBe('Unknown');
    });

    it('should return "Unknown" for undefined', () => {
      expect(formatMileage(undefined)).toBe('Unknown');
    });

    it('should format zero correctly', () => {
      expect(formatMileage(0)).toBe('0 miles');
    });

    it('should format small numbers without separator', () => {
      expect(formatMileage(100)).toBe('100 miles');
    });
  });

  describe('MILEAGE_SANITY_CONFIG', () => {
    it('should have expected default values', () => {
      expect(MILEAGE_SANITY_CONFIG.MAX_DECREASE_ALLOWED).toBe(1000);
      expect(MILEAGE_SANITY_CONFIG.MAX_INCREASE_THRESHOLD).toBe(5000);
      expect(MILEAGE_SANITY_CONFIG.DOUBLING_CHECK_THRESHOLD).toBe(100000);
    });
  });
});
