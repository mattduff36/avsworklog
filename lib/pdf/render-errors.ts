import { isNetworkFetchError } from '@/lib/utils/http-error';

export function isExpectedPdfRenderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();

  return (
    name.includes('renderingcancelledexception') ||
    message.includes('rendering cancelled') ||
    message.includes('transport destroyed')
  );
}

export function isExpectedPdfLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return (
    isNetworkFetchError(error) ||
    name.includes('invalidpdfexception') ||
    message.includes('invalid pdf structure') ||
    message.includes('unexpected server response (400)') ||
    message.includes('unexpected server response (401)') ||
    message.includes('unexpected server response (403)') ||
    message.includes('unexpected server response (404)')
  );
}

export function getPdfLoadMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return 'Failed to load PDF';
  }

  const message = error.message;
  if (isNetworkFetchError(error)) {
    return 'Unable to load PDF. Please check your connection and try again.';
  }

  if (/(400|401|403)/.test(message) && message.includes('Unexpected server response')) {
    return 'This PDF link has expired or is unavailable. Please reopen the document and try again.';
  }

  if (/404/.test(message) && message.includes('Unexpected server response')) {
    return 'This PDF is no longer available.';
  }

  if (error.name === 'InvalidPDFException' || message.includes('Invalid PDF structure')) {
    return 'This PDF could not be opened. Please regenerate the document and try again.';
  }

  return message;
}
