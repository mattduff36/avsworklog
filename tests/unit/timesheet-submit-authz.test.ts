import { describe, expect, it } from 'vitest';
import { authorizeTimesheetSubmit } from '@/lib/server/timesheet-submit';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';

describe('timesheet submit authorization helper', () => {
  it('allows owner self-submit and scoped authoriser, denies cross-user and impersonation', () => {
    expect(
      authorizeTimesheetSubmit({
        actorId: OWNER,
        targetUserId: OWNER,
        canAuthoriseTarget: false,
      })
    ).toBe(true);
    expect(
      authorizeTimesheetSubmit({
        actorId: OWNER,
        targetUserId: OTHER,
        canAuthoriseTarget: false,
      })
    ).toBe(false);
    expect(
      authorizeTimesheetSubmit({
        actorId: ADMIN,
        targetUserId: OTHER,
        canAuthoriseTarget: true,
      })
    ).toBe(true);
    expect(
      authorizeTimesheetSubmit({
        actorId: ADMIN,
        targetUserId: ADMIN,
        canAuthoriseTarget: false,
      })
    ).toBe(true);
    expect(
      authorizeTimesheetSubmit({
        actorId: ADMIN,
        targetUserId: OTHER,
        canAuthoriseTarget: false,
      })
    ).toBe(false);
  });
});
