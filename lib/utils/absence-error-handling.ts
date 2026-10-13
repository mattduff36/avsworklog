const EXPECTED_ABSENCE_VALIDATION_MESSAGES = [
  'This absence conflicts with an existing approved/pending booking',
  'This absence conflicts with an existing approved/processed/pending booking',
  'Annual leave request exceeds available allowance',
  'This half-day conflicts with an existing multi-day or different-day booking',
  'This half-day conflicts with an existing full-day booking',
  'half-day is already booked',
  'Half-day absences require AM or PM session',
  'Half-day absences must be a single day',
  'This absence is in a closed financial year and is read-only',
  'This financial year is closed for employee bookings. Please contact your manager.',
  'Cannot modify absences from a closed financial year',
];

const EXPECTED_ABSENCE_ACCESS_MESSAGES = [
  'Forbidden: Work shifts access required',
  'Forbidden: Work shifts edit access required',
  'Forbidden: Out of scope for this team',
  'Unauthorized',
  'Not authenticated',
  'Session is locked',
  'JWT expired',
  'We could not verify your session, so data loading has been paused.',
  'Not authorised to approve, reject, or process this absence',
  'Not authorised to approve or reject this absence',
  'Not authorised to cancel this absence',
];

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }

  return '';
}

export function getErrorMessage(error: unknown, fallback: string): string {
  const message = extractErrorMessage(error).trim();
  return message.length > 0 ? message : fallback;
}

export function isNetworkFetchError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  if (!message) {
    return false;
  }

  return (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.toLowerCase().includes('network')
  );
}

export function isExpectedAbsenceValidationError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  if (!message) {
    return false;
  }

  return EXPECTED_ABSENCE_VALIDATION_MESSAGES.some((value) => message.includes(value));
}

export function isExpectedAbsenceAccessError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  if (!message) {
    return false;
  }

  return EXPECTED_ABSENCE_ACCESS_MESSAGES.some((value) => message.includes(value));
}

export function shouldLogAbsenceManageError(error: unknown): boolean {
  return (
    !isExpectedAbsenceValidationError(error) &&
    !isExpectedAbsenceAccessError(error) &&
    !isNetworkFetchError(error)
  );
}

const STALE_ABSENCE_DELETE_MESSAGES = new Set([
  'Absence record not found',
  'Absence not found',
]);

function staleAbsenceDeleteText(error: unknown): string {
  const direct = extractErrorMessage(error).trim();
  if (direct) return direct;

  if (error && typeof error === 'object' && 'error' in error) {
    const nested = (error as { error?: unknown }).error;
    if (typeof nested === 'string') return nested.trim();
  }

  return '';
}

function readStructuredStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  for (const value of [record.status, record.statusCode, record.code]) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  }
  return null;
}

/**
 * Missing-row delete only. Exact copy from the financial-year guard and the
 * historical absence API message. A 404 may accompany that copy; generic
 * not-found text and 401/403/500 never qualify.
 */
export function isStaleAbsenceDeleteError(error: unknown): boolean {
  const message = staleAbsenceDeleteText(error);
  if (!STALE_ABSENCE_DELETE_MESSAGES.has(message)) return false;

  const status = readStructuredStatus(error);
  if (status !== null && status !== 404) return false;
  return true;
}

export function staleAbsenceDeleteUserMessage(listRefreshed: boolean): string {
  return listRefreshed
    ? 'This absence is no longer available. The list has been refreshed.'
    : 'This absence is no longer available.';
}

export type AbsenceDeleteFailurePlan =
  | {
      kind: 'stale';
      closeConfirmation: true;
      clearTarget: true;
      refreshAllowance: true;
      toast: 'warning';
      message: string;
    }
  | { kind: 'unchanged' };

export function planAbsenceDeleteFailure(
  error: unknown,
  options: { listRefetchSucceeded: boolean }
): AbsenceDeleteFailurePlan {
  if (!isStaleAbsenceDeleteError(error)) return { kind: 'unchanged' };
  return {
    kind: 'stale',
    closeConfirmation: true,
    clearTarget: true,
    refreshAllowance: true,
    toast: 'warning',
    message: staleAbsenceDeleteUserMessage(options.listRefetchSucceeded),
  };
}
