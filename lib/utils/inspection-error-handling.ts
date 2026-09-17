import { createStatusError, getErrorStatus, isNetworkFetchError, type StatusError } from '@/lib/utils/http-error';

export type LockedDefectCheckStatuses = {
  lockedStatus: number;
  recentStatus: number;
};

function extractInspectionErrorMessage(error: unknown): string {
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

function extractInspectionErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }

  return '';
}

const INSPECTION_WRITE_MISS_MESSAGE =
  'This draft could not be saved. It may have been submitted, removed, or your session may have expired. Refresh and try again.';

export type LockedDefectsLoadState = 'idle' | 'loading' | 'ready' | 'failed';

export function canSubmitAfterLockedDefectsCheck(input: {
  isHiredPlant: boolean;
  state: LockedDefectsLoadState;
  selectedPlantId?: string | null;
  checkedPlantId?: string | null;
}): boolean {
  if (input.isHiredPlant) return true;
  return Boolean(
    input.selectedPlantId &&
    input.checkedPlantId === input.selectedPlantId &&
    input.state === 'ready'
  );
}

export function createLockedDefectsCheckError(
  lockedStatus: number,
  recentStatus: number,
): StatusError {
  const preferredStatus = [lockedStatus, recentStatus].find((status) => status >= 500)
    ?? ([lockedStatus, recentStatus].find((status) => status === 401) ?? lockedStatus);
  return createStatusError(
    `Locked defect checks failed (${lockedStatus}/${recentStatus})`,
    preferredStatus,
    { lockedStatus, recentStatus } satisfies LockedDefectCheckStatuses,
  );
}

export function getLockedDefectCheckStatuses(error: unknown): LockedDefectCheckStatuses | null {
  if (!error || typeof error !== 'object') return null;
  const cause = 'cause' in error ? (error as { cause?: unknown }).cause : error;
  if (!cause || typeof cause !== 'object') return null;
  if (!('lockedStatus' in cause) || !('recentStatus' in cause)) return null;
  const lockedStatus = Number((cause as { lockedStatus?: unknown }).lockedStatus);
  const recentStatus = Number((cause as { recentStatus?: unknown }).recentStatus);
  if (!Number.isFinite(lockedStatus) || !Number.isFinite(recentStatus)) return null;
  return { lockedStatus, recentStatus };
}

export function lockedDefectsFailureIncludesUnauthorized(error: unknown): boolean {
  const statuses = getLockedDefectCheckStatuses(error);
  if (statuses) {
    return statuses.lockedStatus === 401 || statuses.recentStatus === 401;
  }
  return getErrorStatus(error) === 401 || extractInspectionErrorMessage(error).includes('401');
}

export function getLockedDefectsFailureLogMethod(error: unknown): 'warn' | 'error' {
  if (isNetworkFetchError(error)) return 'warn';

  const statuses = getLockedDefectCheckStatuses(error);
  if (statuses) {
    if (statuses.lockedStatus >= 500 || statuses.recentStatus >= 500) return 'error';
    if (statuses.lockedStatus === 401 || statuses.recentStatus === 401) return 'warn';
    return 'error';
  }

  const status = getErrorStatus(error);
  if (status === 401) return 'warn';
  if (typeof status === 'number' && status >= 500) return 'error';

  const message = extractInspectionErrorMessage(error);
  const match = message.match(/Locked defect checks failed \((\d+)\/(\d+)\)/);
  if (match) {
    const lockedStatus = Number(match[1]);
    const recentStatus = Number(match[2]);
    if (lockedStatus >= 500 || recentStatus >= 500) return 'error';
    if (lockedStatus === 401 || recentStatus === 401) return 'warn';
  }

  return 'error';
}

export function reportLockedDefectsLoadFailure(
  error: unknown,
  logger: Pick<Console, 'warn' | 'error'> = console
): LockedDefectsLoadState {
  if (getLockedDefectsFailureLogMethod(error) === 'warn') {
    logger.warn('Unable to load locked defects (network):', error);
  } else {
    logger.error('Error loading locked defects:', error);
  }
  return 'failed';
}

export function isPostgrestNoRowError(error: unknown): boolean {
  const code = extractInspectionErrorCode(error).trim();
  if (code === 'PGRST116') {
    return true;
  }

  return extractInspectionErrorMessage(error)
    .toLowerCase()
    .includes('cannot coerce the result to a single json object');
}

export function getInspectionErrorMessage(error: unknown, fallback: string): string {
  if (isPostgrestNoRowError(error)) {
    return INSPECTION_WRITE_MISS_MESSAGE;
  }

  const message = extractInspectionErrorMessage(error).trim();
  return message.length > 0 ? message : fallback;
}

export function isDuplicateInspectionError(error: unknown): boolean {
  const message = extractInspectionErrorMessage(error).toLowerCase();
  const code = extractInspectionErrorCode(error).trim();

  return (
    code === '23505' ||
    message.includes('duplicate key') ||
    message.includes('already exists') ||
    message.includes('unique constraint')
  );
}

export function isMissingDraftError(error: unknown): boolean {
  const message = extractInspectionErrorMessage(error).trim().toLowerCase();
  return (
    isPostgrestNoRowError(error) ||
    message === 'draft not found' ||
    message.includes('no rows returned') ||
    message.includes('this draft could not be saved')
  );
}
