const ATTACHMENT_UNDO_GRACE_PERIOD_MS = 10 * 60 * 1000;

function parseCompletedAt(completedAt: string | null | undefined): number | null {
  if (!completedAt) return null;
  const completedAtMs = Date.parse(completedAt);
  return Number.isNaN(completedAtMs) ? null : completedAtMs;
}

export function getAttachmentUndoDeadline(completedAt: string | null | undefined): Date | null {
  const completedAtMs = parseCompletedAt(completedAt);
  if (completedAtMs === null) return null;
  return new Date(completedAtMs + ATTACHMENT_UNDO_GRACE_PERIOD_MS);
}

export function getAttachmentUndoRemainingMs(
  completedAt: string | null | undefined,
  now: Date = new Date(),
): number {
  const deadline = getAttachmentUndoDeadline(completedAt);
  if (!deadline) return 0;
  return Math.max(0, deadline.getTime() - now.getTime());
}

export function canUndoAttachmentCompletion(
  completedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return getAttachmentUndoRemainingMs(completedAt, now) > 0;
}

export function formatAttachmentUndoRemaining(
  completedAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const remainingMs = getAttachmentUndoRemainingMs(completedAt, now);
  if (remainingMs <= 0) return null;

  const totalMinutes = Math.ceil(remainingMs / 60000);
  if (totalMinutes <= 1) return 'less than 1 minute left';
  return `${totalMinutes} minutes left`;
}

export { ATTACHMENT_UNDO_GRACE_PERIOD_MS };
