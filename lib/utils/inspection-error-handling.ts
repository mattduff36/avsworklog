import { isNetworkFetchError } from '@/lib/utils/http-error';

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

export function getLockedDefectsFailureLogMethod(error: unknown): 'warn' | 'error' {
  return isNetworkFetchError(error) ? 'warn' : 'error';
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
