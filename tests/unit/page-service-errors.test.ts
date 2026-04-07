import { describe, expect, it } from 'vitest';
import {
  clearPageServiceError,
  getFirstPageServiceError,
  setPageServiceError,
  type PageServiceErrorMap,
} from '@/lib/utils/page-service-errors';

type TestKey = 'generationStatus' | 'absenceAnnouncement' | 'currentWorkShift';

const PRIORITY: readonly TestKey[] = [
  'generationStatus',
  'absenceAnnouncement',
  'currentWorkShift',
];

describe('page service errors', () => {
  it('does not clear one source error when another source succeeds', () => {
    let state: PageServiceErrorMap<TestKey> = {};

    state = setPageServiceError(state, 'generationStatus', {
      status: 503,
      message: 'Booking window is temporarily unavailable.',
    });
    state = setPageServiceError(state, 'absenceAnnouncement', {
      status: 502,
      message: 'Announcement is temporarily unavailable.',
    });

    state = clearPageServiceError(state, 'absenceAnnouncement');

    expect(getFirstPageServiceError(state, PRIORITY)).toEqual({
      status: 503,
      message: 'Booking window is temporarily unavailable.',
    });
  });

  it('returns null when all source errors are cleared', () => {
    let state: PageServiceErrorMap<TestKey> = {};

    state = setPageServiceError(state, 'currentWorkShift', {
      status: null,
      message: 'Work shift data is temporarily unavailable.',
    });
    state = clearPageServiceError(state, 'currentWorkShift');

    expect(getFirstPageServiceError(state, PRIORITY)).toBeNull();
  });
});
