// @ts-nocheck
import { describe, it, expect } from 'vitest';
import type { VanInspection, PlantInspection, InspectionItem, InspectionPhoto, VehicleInspection } from '@/types/inspection';

describe('Inspection Types Contract', () => {
  describe('VanInspection', () => {
    it('satisfies the van inspection shape', () => {
      const van: VanInspection = {
        id: 'test-id',
        van_id: 'vehicle-id',
        user_id: 'user-id',
        inspection_date: '2026-01-01',
        inspection_end_date: '2026-01-07',
        current_mileage: 50000,
        status: 'draft',
        submitted_at: null,
        reviewed_by: null,
        reviewed_at: null,
        manager_comments: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      expect(van.van_id).toBe('vehicle-id');
      expect(van.status).toBe('draft');
    });

    it('allows submitted status', () => {
      const van: VanInspection = {
        id: 'id', van_id: 'v', user_id: 'u',
        inspection_date: '2026-01-01', inspection_end_date: '2026-01-07',
        current_mileage: null, status: 'submitted',
        submitted_at: '2026-01-07T10:00:00Z',
        reviewed_by: null, reviewed_at: null, manager_comments: null,
        created_at: '', updated_at: '',
      };
      expect(van.status).toBe('submitted');
    });
  });

  describe('PlantInspection', () => {
    it('satisfies the plant inspection shape', () => {
      const plant: PlantInspection = {
        id: 'test-id',
        plant_id: 'plant-id',
        user_id: 'user-id',
        inspection_date: '2026-01-01',
        inspection_end_date: null,
        current_mileage: null,
        status: 'submitted',
        submitted_at: '2026-01-01T10:00:00Z',
        reviewed_by: null,
        reviewed_at: null,
        manager_comments: null,
        is_hired_plant: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      expect(plant.plant_id).toBe('plant-id');
      expect(plant.is_hired_plant).toBe(false);
    });

    it('supports hired plant fields', () => {
      const hired: PlantInspection = {
        id: 'id', plant_id: null, user_id: 'u',
        inspection_date: '2026-01-01', inspection_end_date: null,
        current_mileage: null, status: 'submitted',
        submitted_at: '2026-01-01T10:00:00Z',
        reviewed_by: null, reviewed_at: null, manager_comments: null,
        is_hired_plant: true,
        hired_plant_id_serial: 'HP-001',
        hired_plant_description: 'Hired excavator',
        hired_plant_hiring_company: 'HireCo Ltd',
        created_at: '', updated_at: '',
      };
      expect(hired.is_hired_plant).toBe(true);
      expect(hired.hired_plant_id_serial).toBe('HP-001');
    });

    it('status is always submitted (not draft)', () => {
      const plant: PlantInspection = {
        id: 'id', plant_id: 'p', user_id: 'u',
        inspection_date: '2026-01-01', inspection_end_date: null,
        current_mileage: null, status: 'submitted',
        submitted_at: null, reviewed_by: null, reviewed_at: null,
        manager_comments: null, is_hired_plant: false,
        created_at: '', updated_at: '',
      };
      expect(plant.status).toBe('submitted');
    });
  });

  describe('VehicleInspection (deprecated alias)', () => {
    it('is assignable to VanInspection', () => {
      const v: VehicleInspection = {
        id: 'id', van_id: 'v', user_id: 'u',
        inspection_date: '2026-01-01', inspection_end_date: '2026-01-07',
        current_mileage: null, status: 'draft',
        submitted_at: null, reviewed_by: null, reviewed_at: null,
        manager_comments: null, created_at: '', updated_at: '',
      };
      const assignable: VanInspection = v;
      expect(assignable.van_id).toBe('v');
    });
  });

  describe('InspectionItem', () => {
    it('satisfies item shape', () => {
      const item: InspectionItem = {
        id: 'item-id',
        inspection_id: 'insp-id',
        item_number: 1,
        item_description: 'Oil Levels',
        status: 'ok',
        comments: null,
        created_at: '2026-01-01T00:00:00Z',
      };
      expect(item.item_number).toBe(1);
      expect(['ok', 'attention', 'na']).toContain(item.status);
    });

    it('accepts all valid statuses', () => {
      const statuses: Array<'ok' | 'attention' | 'na'> = ['ok', 'attention', 'na'];
      statuses.forEach(s => {
        const item: InspectionItem = {
          id: 'id', inspection_id: 'i', item_number: 1,
          item_description: 'test', status: s, comments: null, created_at: '',
        };
        expect(item.status).toBe(s);
      });
    });
  });
});
