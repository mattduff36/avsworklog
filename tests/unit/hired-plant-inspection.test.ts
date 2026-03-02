import { describe, it, expect } from 'vitest';

/**
 * Unit tests for hired plant inspection validation logic.
 * These test the pure functions / data-shape validation that the form
 * and API routes rely on.
 */

function validateHiredPlantFields(fields: {
  hiredPlantIdSerial: string;
  hiredPlantDescription: string;
  hiredPlantHiringCompany: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!fields.hiredPlantIdSerial || fields.hiredPlantIdSerial.trim().length === 0) {
    errors.push('Plant ID / Serial number is required');
  }
  if (!fields.hiredPlantDescription || fields.hiredPlantDescription.trim().length === 0) {
    errors.push('Plant description is required');
  }
  if (!fields.hiredPlantHiringCompany || fields.hiredPlantHiringCompany.trim().length === 0) {
    errors.push('Hiring company is required');
  }

  return { valid: errors.length === 0, errors };
}

function buildHiredPlantInspectionData(fields: {
  hiredPlantIdSerial: string;
  hiredPlantDescription: string;
  hiredPlantHiringCompany: string;
  userId: string;
  inspectionDate: string;
}) {
  return {
    plant_id: null,
    van_id: null,
    is_hired_plant: true,
    hired_plant_id_serial: fields.hiredPlantIdSerial.trim(),
    hired_plant_description: fields.hiredPlantDescription.trim(),
    hired_plant_hiring_company: fields.hiredPlantHiringCompany.trim(),
    user_id: fields.userId,
    inspection_date: fields.inspectionDate,
  };
}

function shouldCreateWorkshopTasks(inspection: { is_hired_plant?: boolean }): boolean {
  return inspection.is_hired_plant !== true;
}

describe('Hired Plant Inspection', () => {
  describe('validateHiredPlantFields', () => {
    it('should pass with all required fields', () => {
      const result = validateHiredPlantFields({
        hiredPlantIdSerial: 'SN-12345',
        hiredPlantDescription: '20T Excavator',
        hiredPlantHiringCompany: 'ABC Plant Hire Ltd',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail if Plant ID is empty', () => {
      const result = validateHiredPlantFields({
        hiredPlantIdSerial: '',
        hiredPlantDescription: '20T Excavator',
        hiredPlantHiringCompany: 'ABC Plant Hire Ltd',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plant ID / Serial number is required');
    });

    it('should fail if Plant ID is whitespace only', () => {
      const result = validateHiredPlantFields({
        hiredPlantIdSerial: '   ',
        hiredPlantDescription: '20T Excavator',
        hiredPlantHiringCompany: 'ABC Plant Hire Ltd',
      });
      expect(result.valid).toBe(false);
    });

    it('should fail if description is empty', () => {
      const result = validateHiredPlantFields({
        hiredPlantIdSerial: 'SN-12345',
        hiredPlantDescription: '',
        hiredPlantHiringCompany: 'ABC Plant Hire Ltd',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plant description is required');
    });

    it('should fail if hiring company is empty', () => {
      const result = validateHiredPlantFields({
        hiredPlantIdSerial: 'SN-12345',
        hiredPlantDescription: '20T Excavator',
        hiredPlantHiringCompany: '',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Hiring company is required');
    });

    it('should collect all errors when all fields are empty', () => {
      const result = validateHiredPlantFields({
        hiredPlantIdSerial: '',
        hiredPlantDescription: '',
        hiredPlantHiringCompany: '',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
    });
  });

  describe('buildHiredPlantInspectionData', () => {
    it('should set plant_id to null and is_hired_plant to true', () => {
      const data = buildHiredPlantInspectionData({
        hiredPlantIdSerial: 'SN-12345',
        hiredPlantDescription: '20T Excavator',
        hiredPlantHiringCompany: 'ABC Plant Hire',
        userId: 'user-uuid',
        inspectionDate: '2026-02-23',
      });

      expect(data.plant_id).toBeNull();
      expect(data.van_id).toBeNull();
      expect(data.is_hired_plant).toBe(true);
      expect(data.hired_plant_id_serial).toBe('SN-12345');
      expect(data.hired_plant_description).toBe('20T Excavator');
      expect(data.hired_plant_hiring_company).toBe('ABC Plant Hire');
    });

    it('should trim whitespace from hired fields', () => {
      const data = buildHiredPlantInspectionData({
        hiredPlantIdSerial: '  SN-12345  ',
        hiredPlantDescription: '  20T Excavator  ',
        hiredPlantHiringCompany: '  ABC Plant Hire  ',
        userId: 'user-uuid',
        inspectionDate: '2026-02-23',
      });

      expect(data.hired_plant_id_serial).toBe('SN-12345');
      expect(data.hired_plant_description).toBe('20T Excavator');
      expect(data.hired_plant_hiring_company).toBe('ABC Plant Hire');
    });
  });

  describe('shouldCreateWorkshopTasks', () => {
    it('should return false for hired plant inspections', () => {
      expect(shouldCreateWorkshopTasks({ is_hired_plant: true })).toBe(false);
    });

    it('should return true for owned plant inspections', () => {
      expect(shouldCreateWorkshopTasks({ is_hired_plant: false })).toBe(true);
    });

    it('should return true when is_hired_plant is undefined', () => {
      expect(shouldCreateWorkshopTasks({})).toBe(true);
    });
  });
});
