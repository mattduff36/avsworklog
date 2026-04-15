import { describe, expect, it } from 'vitest';
import {
  isExpectedAbsenceAccessError,
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

  it('treats closed financial year write attempts as expected validation errors', () => {
    expect(
      shouldLogAbsenceManageError(new Error('Cannot modify absences from a closed financial year'))
    ).toBe(false);
  });

  it('still logs unexpected runtime errors', () => {
    expect(shouldLogAbsenceManageError(new Error('TypeError: Cannot read properties of undefined'))).toBe(true);
  });
});
