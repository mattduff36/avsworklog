import { describe, expect, it } from 'vitest';
import {
  getAbsenceApprovalActionVisibility,
  getApprovalsAbsenceFilterOptions,
  getApprovalsTimesheetFilterOptions,
  getTimesheetApprovalActionVisibility,
  getTimesheetBulkToolbarVisibility,
  partitionTimesheetBulkSelection,
  resolveTimesheetPrimaryGate,
  resolveApprovalsActorKind,
} from '@/lib/utils/approvals-action-visibility';

describe('resolveApprovalsActorKind', () => {
  it('treats admin tier as admin even on the Accounts team', () => {
    expect(resolveApprovalsActorKind({ isAdminTier: true, isAccountsActor: true })).toBe('admin');
  });

  it('treats Accounts override without admin as accounts', () => {
    expect(resolveApprovalsActorKind({ isAdminTier: false, isAccountsActor: true })).toBe('accounts');
  });

  it('treats remaining authorisers as managers', () => {
    expect(resolveApprovalsActorKind({ isAdminTier: false, isAccountsActor: false })).toBe('manager');
  });
});

describe('getTimesheetApprovalActionVisibility', () => {
  it('hides Payroll Received and Edit for managers on pending sheets', () => {
    expect(getTimesheetApprovalActionVisibility({ actorKind: 'manager', status: 'submitted' })).toEqual({
      showPayrollReceived: false,
      showManagerApproved: true,
      showReject: true,
      showEdit: false,
    });
  });

  it('hides Manager Approved for Accounts on pending sheets', () => {
    expect(getTimesheetApprovalActionVisibility({ actorKind: 'accounts', status: 'submitted' })).toEqual({
      showPayrollReceived: true,
      showManagerApproved: false,
      showReject: true,
      showEdit: true,
    });
  });

  it('keeps Accounts Edit on Complete and hides Reject', () => {
    expect(getTimesheetApprovalActionVisibility({ actorKind: 'accounts', status: 'processed' })).toEqual({
      showPayrollReceived: false,
      showManagerApproved: false,
      showReject: false,
      showEdit: true,
    });
  });

  it('shows every remaining action to admin', () => {
    expect(getTimesheetApprovalActionVisibility({ actorKind: 'admin', status: 'submitted' })).toEqual({
      showPayrollReceived: true,
      showManagerApproved: true,
      showReject: true,
      showEdit: true,
    });
  });
});

describe('getAbsenceApprovalActionVisibility', () => {
  it('gives managers pending approve and reject only', () => {
    expect(getAbsenceApprovalActionVisibility({ actorKind: 'manager', status: 'pending' })).toEqual({
      showApprove: true,
      showReject: true,
      showProcess: false,
    });
  });

  it('gives Accounts process on approved only', () => {
    expect(getAbsenceApprovalActionVisibility({ actorKind: 'accounts', status: 'approved' })).toEqual({
      showApprove: false,
      showReject: false,
      showProcess: true,
    });
    expect(getAbsenceApprovalActionVisibility({ actorKind: 'accounts', status: 'pending' })).toEqual({
      showApprove: false,
      showReject: false,
      showProcess: false,
    });
  });
});

describe('getApprovalsTimesheetFilterOptions', () => {
  it('hides payroll-only filters from managers and manager-only filters from Accounts', () => {
    expect(getApprovalsTimesheetFilterOptions('manager')).not.toContain('awaiting_payroll');
    expect(getApprovalsTimesheetFilterOptions('accounts')).not.toContain('awaiting_manager');
    expect(getApprovalsTimesheetFilterOptions('admin')).toContain('awaiting_payroll');
    expect(getApprovalsTimesheetFilterOptions('admin')).toContain('awaiting_manager');
  });
});

describe('getApprovalsAbsenceFilterOptions', () => {
  it('keeps pending off the Accounts list', () => {
    expect(getApprovalsAbsenceFilterOptions('accounts')).toEqual(['approved', 'processed', 'all']);
  });
});

describe('resolveTimesheetPrimaryGate', () => {
  it('keeps one filled primary when admin can take both gates', () => {
    expect(
      resolveTimesheetPrimaryGate({
        showPayrollReceived: true,
        showManagerApproved: true,
        filter: 'awaiting_payroll',
      })
    ).toBe('payroll');
    expect(
      resolveTimesheetPrimaryGate({
        showPayrollReceived: true,
        showManagerApproved: true,
        filter: 'awaiting_manager',
      })
    ).toBe('manager');
  });
});

describe('getTimesheetBulkToolbarVisibility', () => {
  it('shows only the actor primary action, or both when admin selection is mixed', () => {
    expect(
      getTimesheetBulkToolbarVisibility({
        actorKind: 'manager',
        selectedStatuses: ['submitted', 'approved'],
      })
    ).toEqual({ showPayrollReceived: false, showManagerApproved: true });
    expect(
      getTimesheetBulkToolbarVisibility({
        actorKind: 'accounts',
        selectedStatuses: ['submitted', 'manager_approved'],
      })
    ).toEqual({ showPayrollReceived: true, showManagerApproved: false });
    expect(
      getTimesheetBulkToolbarVisibility({
        actorKind: 'admin',
        selectedStatuses: ['approved', 'manager_approved'],
      })
    ).toEqual({ showPayrollReceived: true, showManagerApproved: true });
  });

  it('limits admin bulk actions to the current queue filter', () => {
    expect(
      getTimesheetBulkToolbarVisibility({
        actorKind: 'admin',
        selectedStatuses: ['submitted'],
        filter: 'awaiting_payroll',
      })
    ).toEqual({ showPayrollReceived: true, showManagerApproved: false });
    expect(
      getTimesheetBulkToolbarVisibility({
        actorKind: 'admin',
        selectedStatuses: ['submitted'],
        filter: 'awaiting_manager',
      })
    ).toEqual({ showPayrollReceived: false, showManagerApproved: true });
  });
});

describe('partitionTimesheetBulkSelection', () => {
  it('skips already-gated or role-hidden rows', () => {
    const result = partitionTimesheetBulkSelection({
      actorKind: 'manager',
      action: 'manager',
      rows: [
        { id: 'pending', status: 'submitted' },
        { id: 'already-manager', status: 'manager_approved' },
        { id: 'complete', status: 'processed' },
      ],
    });

    expect(result.eligibleIds).toEqual(['pending']);
    expect(result.skippedCount).toBe(2);
  });
});
