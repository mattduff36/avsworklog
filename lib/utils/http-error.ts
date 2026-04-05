export interface StatusError extends Error {
  status?: number;
  cause?: unknown;
}

export function createStatusError(message: string, status?: number, cause?: unknown): StatusError {
  const error = new Error(message) as StatusError;
  if (typeof status === 'number') {
    error.status = status;
  }
  if (typeof cause !== 'undefined') {
    error.cause = cause;
  }
  return error;
}

export function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  if ('status' in error && typeof error.status === 'number') {
    return error.status;
  }

  return null;
}

export function isAuthErrorStatus(status: number | null | undefined): boolean {
  return status === 401 || status === 423;
}
