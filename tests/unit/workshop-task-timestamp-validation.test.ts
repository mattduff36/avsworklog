import { describe, expect, it } from 'vitest';
import { ensureMilestoneStatusHistory } from '@/lib/utils/workshopTaskTimeline';
import { validateWorkshopTaskTimestampAdjustment } from '@/lib/utils/workshop-task-timestamp-validation';

describe('workshop task timestamp validation', () => {
  it('adds synthetic milestone history when legacy tasks only have scalar dates', () => {
    const history = ensureMilestoneStatusHistory({
      id: 'task-1',
      created_at: '2026-04-13T09:00:00.000Z',
      logged_at: '2026-04-13T10:00:00.000Z',
      logged_by: 'user-1',
      logged_comment: 'Started work',
      actioned_at: '2026-04-13T12:00:00.000Z',
      actioned_by: 'user-2',
      actioned_comment: 'Completed work',
      actioned_signature_data: null,
      actioned_signed_at: null,
      status_history: null,
    });

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      id: 'status:logged:task-1',
      status: 'logged',
      created_at: '2026-04-13T10:00:00.000Z',
      author_id: 'user-1',
      body: 'Started work',
    });
    expect(history[1]).toMatchObject({
      id: 'status:completed:task-1',
      status: 'completed',
      created_at: '2026-04-13T12:00:00.000Z',
      author_id: 'user-2',
      body: 'Completed work',
    });
  });

  it('rejects timestamps that move before the previous event or after the next event', () => {
    const timeline = [
      { timelineItemId: 'created', type: 'created' as const, created_at: '2026-04-13T09:00:00.000Z' },
      { timelineItemId: 'started', type: 'status' as const, created_at: '2026-04-13T10:00:00.000Z' },
      { timelineItemId: 'comment-1', type: 'comment' as const, created_at: '2026-04-13T11:00:00.000Z' },
    ];

    expect(
      validateWorkshopTaskTimestampAdjustment(
        timeline,
        'started',
        '2026-04-13T08:59:00.000Z'
      )
    ).toBe('Timestamp cannot be before the previous timeline event.');

    expect(
      validateWorkshopTaskTimestampAdjustment(
        timeline,
        'started',
        '2026-04-13T11:01:00.000Z'
      )
    ).toBe('Timestamp cannot be after the next timeline event.');
  });
});
