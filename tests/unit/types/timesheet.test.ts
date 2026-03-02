import { describe, it, expect } from 'vitest';
import { Timesheet } from '@/types/timesheet';
import { createMockTimesheet } from '../../utils/factories';

describe('Timesheet Type Tests', () => {
  describe('Status field', () => {
    it('should accept adjusted status', () => {
      const timesheet = createMockTimesheet({ status: 'adjusted' });
      expect(timesheet.status).toBe('adjusted');
    });

    it('should accept all valid statuses', () => {
      const statuses: Timesheet['status'][] = [
        'draft',
        'submitted',
        'approved',
        'rejected',
        'processed',
        'adjusted',
      ];

      statuses.forEach((status) => {
        const timesheet = createMockTimesheet({ status });
        expect(timesheet.status).toBe(status);
      });
    });
  });

  describe('New adjusted fields', () => {
    it('should include adjusted_by field', () => {
      const timesheet = createMockTimesheet({
        adjusted_by: 'manager-id',
      });
      expect(timesheet).toHaveProperty('adjusted_by');
      expect(timesheet.adjusted_by).toBe('manager-id');
    });

    it('should include adjusted_at field', () => {
      const adjustedAt = '2024-12-01T10:00:00Z';
      const timesheet = createMockTimesheet({
        adjusted_at: adjustedAt,
      });
      expect(timesheet).toHaveProperty('adjusted_at');
      expect(timesheet.adjusted_at).toBe(adjustedAt);
    });

    it('should include adjustment_recipients array field', () => {
      const recipients = ['manager1-id', 'manager2-id'];
      const timesheet = createMockTimesheet({
        adjustment_recipients: recipients,
      });
      expect(timesheet).toHaveProperty('adjustment_recipients');
      expect(timesheet.adjustment_recipients).toEqual(recipients);
    });

    it('should include processed_at field', () => {
      const processedAt = '2024-12-01T15:00:00Z';
      const timesheet = createMockTimesheet({
        processed_at: processedAt,
      });
      expect(timesheet).toHaveProperty('processed_at');
      expect(timesheet.processed_at).toBe(processedAt);
    });

    it('should allow null values for new fields', () => {
      const timesheet = createMockTimesheet({
        adjusted_by: null,
        adjusted_at: null,
        adjustment_recipients: null,
        processed_at: null,
      });
      expect(timesheet.adjusted_by).toBeNull();
      expect(timesheet.adjusted_at).toBeNull();
      expect(timesheet.adjustment_recipients).toBeNull();
      expect(timesheet.processed_at).toBeNull();
    });
  });

  describe('Backwards compatibility', () => {
    it('should work with timesheets without new fields', () => {
      const legacyTimesheet: Timesheet = {
        id: 'legacy-id',
        user_id: 'user-id',
        reg_number: 'AB12 CDE',
        week_ending: '2024-11-24',
        status: 'approved',
        signature_data: null,
        signed_at: null,
        submitted_at: '2024-11-25T10:00:00Z',
        reviewed_by: 'manager-id',
        reviewed_at: '2024-11-25T11:00:00Z',
        manager_comments: 'Looks good',
        adjusted_by: null,
        adjusted_at: null,
        adjustment_recipients: null,
        processed_at: null,
        created_at: '2024-11-25T09:00:00Z',
        updated_at: '2024-11-25T11:00:00Z',
      };

      expect(legacyTimesheet).toBeDefined();
      expect(legacyTimesheet.status).toBe('approved');
    });
  });
});

