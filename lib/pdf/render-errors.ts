export function isExpectedPdfRenderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();

  return name.includes('renderingcancelledexception') || message.includes('rendering cancelled');
}
