import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_UNDO_GRACE_PERIOD_MS,
  canUndoAttachmentCompletion,
  formatAttachmentUndoRemaining,
  getAttachmentUndoDeadline,
  getAttachmentUndoRemainingMs,
} from '@/lib/workshop-attachments/completion-window';

describe('workshop attachment completion window', () => {
  it('allows undo within 10 minutes of completion', () => {
    const now = new Date('2026-04-07T10:10:00.000Z');
    const completedAt = '2026-04-07T10:01:00.000Z';

    expect(canUndoAttachmentCompletion(completedAt, now)).toBe(true);
    expect(getAttachmentUndoRemainingMs(completedAt, now)).toBe(60_000);
  });

  it('blocks undo after the 10 minute grace period', () => {
    const now = new Date('2026-04-07T10:11:01.000Z');
    const completedAt = '2026-04-07T10:01:00.000Z';

    expect(canUndoAttachmentCompletion(completedAt, now)).toBe(false);
    expect(getAttachmentUndoRemainingMs(completedAt, now)).toBe(0);
  });

  it('formats the remaining grace period for display', () => {
    const now = new Date('2026-04-07T10:05:30.000Z');
    const completedAt = '2026-04-07T10:01:00.000Z';

    expect(formatAttachmentUndoRemaining(completedAt, now)).toBe('6 minutes left');
  });

  it('calculates the correct undo deadline timestamp', () => {
    const completedAt = '2026-04-07T10:01:00.000Z';
    const deadline = getAttachmentUndoDeadline(completedAt);

    expect(deadline?.toISOString()).toBe('2026-04-07T10:11:00.000Z');
    expect(ATTACHMENT_UNDO_GRACE_PERIOD_MS).toBe(600000);
  });

  it('returns null or zero values for invalid completion timestamps', () => {
    const now = new Date('2026-04-07T10:10:00.000Z');

    expect(getAttachmentUndoDeadline('not-a-date')).toBeNull();
    expect(getAttachmentUndoRemainingMs('not-a-date', now)).toBe(0);
    expect(canUndoAttachmentCompletion('not-a-date', now)).toBe(false);
    expect(formatAttachmentUndoRemaining('not-a-date', now)).toBeNull();
  });
});
