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
];

const EXPECTED_ABSENCE_ACCESS_MESSAGES = [
  'Forbidden: Work shifts access required',
  'Forbidden: Work shifts edit access required',
  'Forbidden: Out of scope for this team',
  'Unauthorized',
  'JWT expired',
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
