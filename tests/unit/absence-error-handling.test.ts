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

  it('still logs unexpected runtime errors', () => {
    expect(shouldLogAbsenceManageError(new Error('TypeError: Cannot read properties of undefined'))).toBe(true);
  });
});
