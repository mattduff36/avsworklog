import { describe, expect, it } from 'vitest';
import {
  createApprovalInFlightGuard,
  isAlreadyApprovedConflict,
} from '@/app/(dashboard)/approvals/approvals-quick-approve';

describe('approvals quick approve helpers', () => {
  it('PAY-APPROVAL-INFLIGHT-001 suppresses overlapping starts and clears afterward', () => {
    const guard = createApprovalInFlightGuard();
    expect(guard.tryBegin('ts-1')).toBe(true);
    expect(guard.tryBegin('ts-1')).toBe(false);
    expect(guard.tryBegin('ts-2')).toBe(true);
    guard.end('ts-1');
    expect(guard.has('ts-1')).toBe(false);
    expect(guard.tryBegin('ts-1')).toBe(true);
  });

  it('PAY-APPROVAL-SOFT-CONFLICT-001 matches only exact already-approved conflicts', () => {
    expect(
      isAlreadyApprovedConflict(
        new Error('Timesheet cannot be approved from status "approved".')
      )
    ).toBe(true);
    expect(
      isAlreadyApprovedConflict(
        new Error('Error approving: Timesheet cannot be approved from status "approved".')
      )
    ).toBe(false);
    expect(
      isAlreadyApprovedConflict(
        new Error('Timesheet cannot be approved from status "approved". Extra detail')
      )
    ).toBe(false);
    expect(
      isAlreadyApprovedConflict(
        new Error('Timesheet cannot be approved from status "processed".')
      )
    ).toBe(false);
    expect(isAlreadyApprovedConflict(new Error('Unauthorized'))).toBe(false);
  });
});
