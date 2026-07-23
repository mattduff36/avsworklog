import { describe, expect, it } from 'vitest';
import {
  canLoadApprovalsFilterDirectory,
  getApprovalsTimesheetStatuses,
  getApprovalsDefaultStatusFilters,
  isAccountsTeam,
  shouldIncludeTimesheetInAllSubmittedFilter,
} from '@/lib/utils/approvals-filters';

describe('canLoadApprovalsFilterDirectory', () => {
  it('loads employee filters only for directory-authorized approval roles', () => {
    expect(canLoadApprovalsFilterDirectory(true, 'admin')).toBe(true);
    expect(canLoadApprovalsFilterDirectory(true, 'manager')).toBe(true);
    expect(canLoadApprovalsFilterDirectory(true, 'supervisor')).toBe(true);
    expect(canLoadApprovalsFilterDirectory(true, 'employee')).toBe(false);
  });

  it('does not load filters before approvals access and role scope are known', () => {
    expect(canLoadApprovalsFilterDirectory(false, 'manager')).toBe(false);
    expect(canLoadApprovalsFilterDirectory(true, null)).toBe(false);
  });
});

describe('getApprovalsDefaultStatusFilters', () => {
  it('uses the Accounts defaults for Accounts team members', () => {
    expect(getApprovalsDefaultStatusFilters('Accounts')).toEqual({
      timesheets: 'pending',
      absences: 'approved',
    });
  });

  it('treats team names case-insensitively', () => {
    expect(getApprovalsDefaultStatusFilters('aCCoUnts')).toEqual({
      timesheets: 'pending',
      absences: 'approved',
    });
  });

  it('uses the non-Accounts defaults for every other team', () => {
    expect(getApprovalsDefaultStatusFilters('Operations')).toEqual({
      timesheets: 'approved',
      absences: 'pending',
    });
  });

  it('falls back to the non-Accounts defaults when no team is present', () => {
    expect(getApprovalsDefaultStatusFilters(null)).toEqual({
      timesheets: 'approved',
      absences: 'pending',
    });
  });
});

describe('isAccountsTeam', () => {
  it('matches the Accounts team name', () => {
    expect(isAccountsTeam('Accounts')).toBe(true);
  });

  it('rejects other team names', () => {
    expect(isAccountsTeam('Transport')).toBe(false);
  });
});

describe('shouldIncludeTimesheetInAllSubmittedFilter', () => {
  it('excludes draft timesheets', () => {
    expect(shouldIncludeTimesheetInAllSubmittedFilter('draft')).toBe(false);
  });

  it('includes submitted timesheet statuses', () => {
    expect(shouldIncludeTimesheetInAllSubmittedFilter('submitted')).toBe(true);
    expect(shouldIncludeTimesheetInAllSubmittedFilter('approved')).toBe(true);
    expect(shouldIncludeTimesheetInAllSubmittedFilter('processed')).toBe(true);
  });
});

describe('getApprovalsTimesheetStatuses', () => {
  it('maps the approvals pending filter to submitted timesheets', () => {
    expect(getApprovalsTimesheetStatuses('pending')).toEqual(['submitted']);
  });

  it('keeps the approvals all filter scoped to non-draft statuses', () => {
    expect(getApprovalsTimesheetStatuses('all')).toEqual([
      'submitted',
      'approved',
      'rejected',
      'processed',
      'adjusted',
    ]);
  });
});
