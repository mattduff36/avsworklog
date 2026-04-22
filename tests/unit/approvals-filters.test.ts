import { describe, expect, it } from 'vitest';
import {
  getApprovalsDefaultStatusFilters,
  isAccountsTeam,
  shouldIncludeTimesheetInAllSubmittedFilter,
} from '@/lib/utils/approvals-filters';

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
