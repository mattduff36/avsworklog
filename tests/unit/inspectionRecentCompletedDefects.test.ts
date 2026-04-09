import { describe, expect, it } from 'vitest';
import { buildRecentCompletedDefectMap } from '@/lib/utils/inspectionRecentCompletedDefects';
import { buildInspectionDefectSignature } from '@/lib/utils/inspectionDefectSignature';

describe('buildRecentCompletedDefectMap', () => {
  it('includes recently completed inspection defects within the lookback window', () => {
    const now = new Date('2026-04-09T12:00:00.000Z');
    const recentCompleted = buildRecentCompletedDefectMap(
      [
        {
          description: 'Van inspection defect found:\nItem 3 - Tyres (Mon)',
          actioned_at: '2026-04-08T09:00:00.000Z',
        },
      ],
      { lookbackDays: 7, now }
    );

    expect(
      recentCompleted.get(
        buildInspectionDefectSignature({ item_number: 3, item_description: 'Tyres' })
      )
    ).toEqual({
      completedAt: '2026-04-08T09:00:00.000Z',
    });
  });

  it('ignores completed tasks outside the lookback window and keeps the latest completion', () => {
    const now = new Date('2026-04-09T12:00:00.000Z');
    const recentCompleted = buildRecentCompletedDefectMap(
      [
        {
          description: 'Van inspection defect found:\nItem 3 - Tyres (Mon)',
          actioned_at: '2026-03-31T09:00:00.000Z',
        },
        {
          description: 'Van inspection defect found:\nItem 3 - Tyres (Tue)',
          actioned_at: '2026-04-07T15:00:00.000Z',
        },
        {
          description: 'Van inspection defect found:\nItem 3 - Tyres (Wed)',
          actioned_at: '2026-04-08T16:30:00.000Z',
        },
      ],
      { lookbackDays: 7, now }
    );

    expect(recentCompleted.size).toBe(1);
    expect(
      recentCompleted.get(
        buildInspectionDefectSignature({ item_number: 3, item_description: 'Tyres' })
      )
    ).toEqual({
      completedAt: '2026-04-08T16:30:00.000Z',
    });
  });
});
