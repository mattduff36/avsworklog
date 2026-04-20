export const CLIENT_SESSION_PAUSED_MESSAGE =
  'We could not verify your session, so data loading has been paused.';

function getErrorMessageText(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }

  return '';
}

export function isClientSessionPausedMessage(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.includes(CLIENT_SESSION_PAUSED_MESSAGE);
}

export function isClientSessionPausedError(error: unknown): boolean {
  return isClientSessionPausedMessage(getErrorMessageText(error));
}
