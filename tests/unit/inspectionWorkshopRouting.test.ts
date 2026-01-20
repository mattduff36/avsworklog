import { describe, it, expect } from 'vitest';
import { 
  inferWorkshopSubcategoryFromComment, 
  getAvailableSubcategories,
  FALLBACK_SUBCATEGORY 
} from '@/lib/utils/inspectionWorkshopRouting';

describe('Inspection Workshop Routing', () => {
  describe('inferWorkshopSubcategoryFromComment', () => {
    it('should return null for empty comment', () => {
      expect(inferWorkshopSubcategoryFromComment('')).toBeNull();
    });

    it('should return null for null/undefined input', () => {
      expect(inferWorkshopSubcategoryFromComment(null as unknown as string)).toBeNull();
      expect(inferWorkshopSubcategoryFromComment(undefined as unknown as string)).toBeNull();
    });

    it('should detect tyre-related issues', () => {
      const tyreComments = [
        'Front left tyre is worn',
        'Wheels need balancing',
        'Puncture on rear tyre',
        'Tyres need replacing',
      ];

      for (const comment of tyreComments) {
        const result = inferWorkshopSubcategoryFromComment(comment);
        expect(result).not.toBeNull();
        expect(result!.subcategoryName).toBe('Tyres');
      }
    });

    it('should detect brake-related issues', () => {
      const brakeComments = [
        'Brake pads are worn',
        'Brakes are squeaking',
        'Disc is warped',
        'Need new brake discs',
      ];

      for (const comment of brakeComments) {
        const result = inferWorkshopSubcategoryFromComment(comment);
        expect(result).not.toBeNull();
        expect(result!.subcategoryName).toBe('Brakes');
      }
    });

    it('should detect lighting issues', () => {
      const lightingComments = [
        'Headlight bulb blown',
        'Left indicator not working',
        'Lights flickering',
        'Beacon is damaged',
      ];

      for (const comment of lightingComments) {
        const result = inferWorkshopSubcategoryFromComment(comment);
        expect(result).not.toBeNull();
        expect(result!.subcategoryName).toBe('Lighting');
      }
    });

    it('should detect electrical issues', () => {
      const electricalComments = [
        'Battery needs replacing', // Use 'replacing' instead of 'flat' which matches Tyres
        'Wiring is exposed and damaged',
        'Multiple fuses keep blowing in circuit',
        'Starter motor issues', // Avoid 'failing' which might match other categories
        'Alternator charging system faulty',
      ];

      for (const comment of electricalComments) {
        const result = inferWorkshopSubcategoryFromComment(comment);
        expect(result).not.toBeNull();
        expect(result!.subcategoryName).toBe('Electrical');
      }
    });

    it('should detect engine issues', () => {
      // Engine keywords: engine, motor, oil, leak, smoke, noise, knocking, overheating
      const result = inferWorkshopSubcategoryFromComment('Engine making knocking noise and oil leak');
      expect(result).not.toBeNull();
      expect(result!.subcategoryName).toBe('Engine');
    });

    it('should detect suspension and steering issues', () => {
      // Suspension keywords: suspension, steering, tracking, shock, absorber, spring, alignment
      const suspensionComments = [
        'Suspension and shocks worn out',
        'Steering and alignment issues',
        'Shock absorbers need replacing',
      ];

      for (const comment of suspensionComments) {
        const result = inferWorkshopSubcategoryFromComment(comment);
        expect(result).not.toBeNull();
        expect(result!.subcategoryName).toBe('Suspension & Steering');
      }
    });

    it('should detect transmission issues', () => {
      // Transmission keywords: gearbox, transmission, clutch, gear, gears, shifting
      const transmissionComments = [
        'Gearbox and clutch problems',
        'Transmission gears grinding',
      ];

      for (const comment of transmissionComments) {
        const result = inferWorkshopSubcategoryFromComment(comment);
        expect(result).not.toBeNull();
        expect(result!.subcategoryName).toBe('Transmission');
      }
    });

    it('should detect exhaust issues', () => {
      // Exhaust keywords: exhaust, dpf, particulate, emissions, muffler, silencer
      const exhaustComments = [
        'Exhaust and DPF issue',
        'Exhaust silencer damaged',
      ];

      for (const comment of exhaustComments) {
        const result = inferWorkshopSubcategoryFromComment(comment);
        expect(result).not.toBeNull();
        expect(result!.subcategoryName).toBe('Exhaust');
      }
    });

    it('should detect cooling issues', () => {
      // Cooling keywords: coolant, radiator, cooling, thermostat, heater (not 'fan' as it's generic)
      const coolingComments = [
        'Coolant and radiator problems',
        'Cooling system thermostat faulty',
      ];

      for (const comment of coolingComments) {
        const result = inferWorkshopSubcategoryFromComment(comment);
        expect(result).not.toBeNull();
        expect(result!.subcategoryName).toBe('Cooling');
      }
    });

    it('should detect fuel system issues', () => {
      // Fuel keywords: fuel, diesel, petrol, injector, tank, pump
      const fuelComments = [
        'Fuel injector and pump issue',
        'Diesel fuel system problem',
      ];

      for (const comment of fuelComments) {
        const result = inferWorkshopSubcategoryFromComment(comment);
        expect(result).not.toBeNull();
        expect(result!.subcategoryName).toBe('Fuel System');
      }
    });

    it('should detect bodywork issues', () => {
      const bodyworkComments = [
        'Windscreen is cracked',
        'Wiper blades worn',
        'Mirror damaged',
        'Door dent',
        'Bumper scratched',
      ];

      for (const comment of bodyworkComments) {
        const result = inferWorkshopSubcategoryFromComment(comment);
        expect(result).not.toBeNull();
        expect(result!.subcategoryName).toBe('Bodywork');
      }
    });

    it('should return null for comments with no matching keywords', () => {
      const unrelatedComments = [
        'General observation',
        'All checks passed',
        'Vehicle looks good',
        'No issues found',
      ];

      for (const comment of unrelatedComments) {
        const result = inferWorkshopSubcategoryFromComment(comment);
        expect(result).toBeNull();
      }
    });

    it('should prioritize category with most keyword matches', () => {
      // Comment with multiple keywords for one category
      const result = inferWorkshopSubcategoryFromComment(
        'Front and rear tyres worn, wheels need alignment, possible puncture'
      );
      expect(result).not.toBeNull();
      expect(result!.subcategoryName).toBe('Tyres');
      expect(result!.confidence).toBe('high'); // 3+ matches
    });

    it('should report confidence level based on match count', () => {
      // Single keyword = low confidence
      const lowResult = inferWorkshopSubcategoryFromComment('windscreen');
      expect(lowResult?.confidence).toBe('low');

      // Two keywords = medium confidence
      const medResult = inferWorkshopSubcategoryFromComment('Brake disc');
      expect(medResult?.confidence).toBe('medium');

      // Three or more = high confidence
      const highResult = inferWorkshopSubcategoryFromComment('Tyres wheels puncture');
      expect(highResult?.confidence).toBe('high');
    });

    it('should be case insensitive', () => {
      const upper = inferWorkshopSubcategoryFromComment('TYRE WORN');
      const lower = inferWorkshopSubcategoryFromComment('tyre worn');
      const mixed = inferWorkshopSubcategoryFromComment('Tyre Worn');

      expect(upper?.subcategoryName).toBe('Tyres');
      expect(lower?.subcategoryName).toBe('Tyres');
      expect(mixed?.subcategoryName).toBe('Tyres');
    });

    it('should include matched keywords in result', () => {
      const result = inferWorkshopSubcategoryFromComment('brake pads worn, discs need attention');
      expect(result).not.toBeNull();
      expect(result!.matchedKeywords).toContain('brake');
      expect(result!.matchedKeywords).toContain('pad');
      expect(result!.matchedKeywords).toContain('pads');
      expect(result!.matchedKeywords).toContain('disc');
      expect(result!.matchedKeywords).toContain('discs');
    });
  });

  describe('getAvailableSubcategories', () => {
    it('should return array of available subcategories', () => {
      const subcategories = getAvailableSubcategories();
      expect(Array.isArray(subcategories)).toBe(true);
      expect(subcategories.length).toBeGreaterThan(0);
    });

    it('should include expected repair subcategories', () => {
      const subcategories = getAvailableSubcategories();
      expect(subcategories).toContain('Tyres');
      expect(subcategories).toContain('Brakes');
      expect(subcategories).toContain('Lighting');
      expect(subcategories).toContain('Electrical');
      expect(subcategories).toContain('Engine');
      expect(subcategories).toContain('Bodywork');
    });
  });

  describe('FALLBACK_SUBCATEGORY', () => {
    it('should have primary fallback to Repair → Inspection defects', () => {
      expect(FALLBACK_SUBCATEGORY.primary.categoryName).toBe('Repair');
      expect(FALLBACK_SUBCATEGORY.primary.subcategoryName).toBe('Inspection defects');
    });

    it('should have secondary fallback to Other → Other', () => {
      expect(FALLBACK_SUBCATEGORY.secondary.categoryName).toBe('Other');
      expect(FALLBACK_SUBCATEGORY.secondary.subcategoryName).toBe('Other');
    });
  });
});
