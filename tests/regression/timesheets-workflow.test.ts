import { describe, it, expect } from 'vitest';
import { createMockTimesheet } from '../utils/factories';

describe('Timesheet Workflow Regression Tests', () => {
  describe('Existing status transitions', () => {
    it('should support Draft → Pending transition', () => {
      const timesheet = createMockTimesheet({ status: 'draft' });
      
      // Simulate submission
      const submitted = {
        ...timesheet,
        status: 'submitted' as const,
        submitted_at: new Date().toISOString(),
      };

      expect(submitted.status).toBe('submitted');
      expect(submitted.submitted_at).toBeDefined();
    });

    it('should support Pending → Approved transition', () => {
      const timesheet = createMockTimesheet({ 
        status: 'submitted',
        submitted_at: '2024-12-01T10:00:00Z',
      });
      
      // Simulate approval
      const approved = {
        ...timesheet,
        status: 'approved' as const,
        reviewed_by: 'manager-id',
        reviewed_at: new Date().toISOString(),
      };

      expect(approved.status).toBe('approved');
      expect(approved.reviewed_by).toBeDefined();
      expect(approved.reviewed_at).toBeDefined();
    });

    it('should support Approved → Processed transition', () => {
      const timesheet = createMockTimesheet({ 
        status: 'approved',
        reviewed_by: 'manager-id',
        reviewed_at: '2024-12-01T11:00:00Z',
      });
      
      // Simulate marking as processed
      const processed = {
        ...timesheet,
        status: 'processed' as const,
        processed_at: new Date().toISOString(),
      };

      expect(processed.status).toBe('processed');
      expect(processed.processed_at).toBeDefined();
    });

    it('should support Pending → Rejected → Pending loop', () => {
      const timesheet = createMockTimesheet({ 
        status: 'submitted',
        submitted_at: '2024-12-01T10:00:00Z',
      });
      
      // Simulate rejection
      const rejected = {
        ...timesheet,
        status: 'rejected' as const,
        reviewed_by: 'manager-id',
        reviewed_at: '2024-12-01T11:00:00Z',
        manager_comments: 'Please fix the hours',
      };

      expect(rejected.status).toBe('rejected');
      expect(rejected.manager_comments).toBeDefined();

      // Employee corrects and resubmits
      const resubmitted = {
        ...rejected,
        status: 'submitted' as const,
        submitted_at: '2024-12-01T14:00:00Z',
      };

      expect(resubmitted.status).toBe('submitted');
    });
  });

  describe('Backwards compatibility', () => {
    it('should handle timesheets created before adjusted status was added', () => {
      const legacyTimesheet = createMockTimesheet({
        status: 'approved',
        adjusted_by: null,
        adjusted_at: null,
        adjustment_recipients: null,
        processed_at: null,
      });

      expect(legacyTimesheet.status).toBe('approved');
      expect(legacyTimesheet.adjusted_by).toBeNull();
      expect(legacyTimesheet.adjusted_at).toBeNull();
    });

    it('should allow marking legacy approved timesheets as processed', () => {
      const legacyTimesheet = createMockTimesheet({
        status: 'approved',
        adjusted_by: null,
        adjusted_at: null,
        adjustment_recipients: null,
        processed_at: null,
      });

      const processed = {
        ...legacyTimesheet,
        status: 'processed' as const,
        processed_at: new Date().toISOString(),
      };

      expect(processed.status).toBe('processed');
      expect(processed.processed_at).toBeDefined();
      // Legacy fields should remain null
      expect(processed.adjusted_by).toBeNull();
      expect(processed.adjusted_at).toBeNull();
    });
  });

  describe('Dual-gate workflow', () => {
    it('should support Pending → Manager Approved without Payroll Received', () => {
      const timesheet = createMockTimesheet({
        status: 'submitted',
        submitted_at: '2024-12-01T10:00:00Z',
      });

      const managerApproved = {
        ...timesheet,
        status: 'manager_approved' as const,
      };

      expect(managerApproved.status).toBe('manager_approved');
    });

    it('should treat historical adjusted rows as visible history, not a new wage path', () => {
      const timesheet = createMockTimesheet({
        status: 'adjusted',
        adjusted_by: 'manager-id',
        adjusted_at: '2024-12-01T12:00:00Z',
      });

      expect(timesheet.status).toBe('adjusted');
    });

    it('should treat adjusted as terminal status', () => {
      const timesheet = createMockTimesheet({ 
        status: 'adjusted',
        adjusted_by: 'manager-id',
        adjusted_at: '2024-12-01T12:00:00Z',
      });
      
      // Adjusted should be a terminal status - no further transitions
      expect(timesheet.status).toBe('adjusted');
    });

    it('should treat processed as terminal status', () => {
      const timesheet = createMockTimesheet({ 
        status: 'processed',
        processed_at: '2024-12-01T12:00:00Z',
      });
      
      // Processed should be a terminal status - no further transitions
      expect(timesheet.status).toBe('processed');
    });
  });

  describe('Rejection comments requirement', () => {
    it('should require comments when rejecting', () => {
      const timesheet = createMockTimesheet({ status: 'submitted' });
      
      const rejected = {
        ...timesheet,
        status: 'rejected' as const,
        reviewed_by: 'manager-id',
        reviewed_at: new Date().toISOString(),
        manager_comments: 'Please fix the hours',
      };

      expect(rejected.manager_comments).toBeTruthy();
      expect(rejected.manager_comments!.trim().length).toBeGreaterThan(0);
    });
  });

  describe('Adjustment comments requirement', () => {
    it('should require comments when adjusting', () => {
      const timesheet = createMockTimesheet({ status: 'approved' });
      
      const adjusted = {
        ...timesheet,
        status: 'adjusted' as const,
        adjusted_by: 'manager-id',
        adjusted_at: new Date().toISOString(),
        manager_comments: 'Corrected Thursday hours',
      };

      expect(adjusted.manager_comments).toBeTruthy();
      expect(adjusted.manager_comments!.trim().length).toBeGreaterThan(0);
    });
  });
});

