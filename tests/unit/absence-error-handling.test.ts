import { describe, expect, it } from 'vitest';
import {
  isExpectedAbsenceAccessError,
  isStaleAbsenceDeleteError,
  planAbsenceDeleteFailure,
  shouldCloseStaleTimesheetOverrideDetail,
  shouldLogAbsenceManageError,
} from '@/lib/utils/absence-error-handling';

describe('absence-error-handling', () => {
  it('treats work-shift permission denials as expected access errors', () => {
    expect(isExpectedAbsenceAccessError(new Error('Forbidden: Work shifts access required'))).toBe(true);
    expect(shouldLogAbsenceManageError(new Error('Forbidden: Work shifts access required'))).toBe(false);
  });

  it('treats scoped out responses as expected access errors', () => {
    expect(isExpectedAbsenceAccessError(new Error('Forbidden: Out of scope for this team'))).toBe(true);
    expect(shouldLogAbsenceManageError(new Error('Forbidden: Out of scope for this team'))).toBe(false);
  });

  it('treats auth recovery failures as expected access errors', () => {
    expect(isExpectedAbsenceAccessError(new Error('Not authenticated'))).toBe(true);
    expect(
      shouldLogAbsenceManageError(
        new Error('We could not verify your session, so data loading has been paused.')
      )
    ).toBe(false);
  });

  it('treats absence status-transition authorisation denials as expected access errors', () => {
    expect(
      isExpectedAbsenceAccessError(
        new Error('Not authorised to approve, reject, or process this absence')
      )
    ).toBe(true);
    expect(
      shouldLogAbsenceManageError(
        new Error('Not authorised to approve, reject, or process this absence')
      )
    ).toBe(false);
    expect(shouldLogAbsenceManageError(new Error('Not authorised to cancel this absence'))).toBe(
      false
    );
  });

  it('treats closed financial year write attempts as expected validation errors', () => {
    expect(
      shouldLogAbsenceManageError(new Error('Cannot modify absences from a closed financial year'))
    ).toBe(false);
  });

  it('still logs unexpected runtime errors', () => {
    expect(shouldLogAbsenceManageError(new Error('TypeError: Cannot read properties of undefined'))).toBe(true);
  });

  it('classifies only the exact stale absence delete messages', () => {
    expect(isStaleAbsenceDeleteError(new Error('Absence record not found'))).toBe(true);
    expect(isStaleAbsenceDeleteError(new Error('Absence not found'))).toBe(true);
    expect(isStaleAbsenceDeleteError('Absence not found')).toBe(true);
    expect(isStaleAbsenceDeleteError({ error: 'Absence not found', status: 404 })).toBe(true);
    expect(isStaleAbsenceDeleteError({ message: 'Absence record not found', statusCode: 404 })).toBe(true);
  });

  it('does not classify generic not-found or auth and server failures as stale deletes', () => {
    expect(isStaleAbsenceDeleteError(new Error('Absence record was not found'))).toBe(false);
    expect(isStaleAbsenceDeleteError(new Error('not found'))).toBe(false);
    expect(isStaleAbsenceDeleteError(new Error('Record not found'))).toBe(false);
    expect(isStaleAbsenceDeleteError({ status: 404, message: 'Not found' })).toBe(false);
    expect(isStaleAbsenceDeleteError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })).toBe(false);
    expect(isStaleAbsenceDeleteError({ code: 404 })).toBe(false);
    expect(isStaleAbsenceDeleteError({ message: 'Absence not found', status: 401 })).toBe(false);
    expect(isStaleAbsenceDeleteError({ message: 'Absence record not found', status: 403 })).toBe(false);
    expect(isStaleAbsenceDeleteError({ message: 'Absence not found', status: 500 })).toBe(false);
    expect(isStaleAbsenceDeleteError({ message: 'Absence not found', code: 500 })).toBe(false);
  });

  it('plans a warning refresh for a stale delete and leaves other failures unchanged', () => {
    const refreshed = planAbsenceDeleteFailure(new Error('Absence record not found'), {
      listRefetchSucceeded: true,
    });
    expect(refreshed).toEqual({
      kind: 'stale',
      closeConfirmation: true,
      clearTarget: true,
      refreshAllowance: true,
      toast: 'warning',
      message: 'This absence is no longer available. The list has been refreshed.',
    });
    expect(refreshed.kind === 'stale' ? refreshed.message : '').not.toMatch(/deleted|success/i);

    const notRefreshed = planAbsenceDeleteFailure(
      { error: 'Absence not found', status: 404 },
      { listRefetchSucceeded: false }
    );
    expect(notRefreshed.kind === 'stale' ? notRefreshed.message : '').toBe(
      'This absence is no longer available.'
    );
    expect(notRefreshed.kind === 'stale' ? notRefreshed.message : '').not.toMatch(/refreshed/i);

    expect(
      planAbsenceDeleteFailure(new Error('Failed to delete absence'), { listRefetchSucceeded: true })
    ).toEqual({ kind: 'unchanged' });
    expect(
      planAbsenceDeleteFailure({ status: 403, message: 'Forbidden' }, { listRefetchSucceeded: true })
    ).toEqual({ kind: 'unchanged' });
  });

  it('plans a warning refresh when a timesheet override hits a missing absence', () => {
    const refreshed = planAbsenceDeleteFailure(new Error('Absence record not found'), {
      listRefetchSucceeded: true,
    });
    expect(refreshed).toEqual({
      kind: 'stale',
      closeConfirmation: true,
      clearTarget: true,
      refreshAllowance: true,
      toast: 'warning',
      message: 'This absence is no longer available. The list has been refreshed.',
    });
    expect(refreshed.kind === 'stale' ? refreshed.message : '').not.toMatch(/enabled|disabled|success/i);

    const pendingRefresh = planAbsenceDeleteFailure(new Error('Absence record not found'), {
      listRefetchSucceeded: false,
    });
    expect(pendingRefresh.kind === 'stale' ? pendingRefresh.message : '').toBe(
      'This absence is no longer available.'
    );

    expect(
      planAbsenceDeleteFailure(new Error('Failed to update timesheet override'), {
        listRefetchSucceeded: true,
      })
    ).toEqual({ kind: 'unchanged' });
    expect(
      planAbsenceDeleteFailure({ status: 403, message: 'Absence record not found' }, {
        listRefetchSucceeded: true,
      })
    ).toEqual({ kind: 'unchanged' });
  });

  it('closes stale timesheet-override detail only after a successful refresh drops the record', () => {
    expect(
      shouldCloseStaleTimesheetOverrideDetail({
        calendarRefetchSucceeded: true,
        refreshedRows: [{ id: 'other-absence' }],
        absenceId: 'missing-absence',
      })
    ).toBe(true);
    expect(
      shouldCloseStaleTimesheetOverrideDetail({
        calendarRefetchSucceeded: true,
        refreshedRows: [{ id: 'missing-absence' }],
        absenceId: 'missing-absence',
      })
    ).toBe(false);
    expect(
      shouldCloseStaleTimesheetOverrideDetail({
        calendarRefetchSucceeded: false,
        refreshedRows: [{ id: 'other-absence' }],
        absenceId: 'missing-absence',
      })
    ).toBe(false);
    expect(
      shouldCloseStaleTimesheetOverrideDetail({
        calendarRefetchSucceeded: true,
        refreshedRows: null,
        absenceId: 'missing-absence',
      })
    ).toBe(false);
  });
});


describe('stale delete structured status strings', () => {
  it('does not refresh away an authorization or server failure', () => {
    for (const status of ['401', '403', '500']) {
      expect(isStaleAbsenceDeleteError({ message: 'Absence not found', status })).toBe(false);
      expect(isStaleAbsenceDeleteError({ message: 'Absence not found', code: status })).toBe(false);
    }
  });
});
