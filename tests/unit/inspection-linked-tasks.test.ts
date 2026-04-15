import { describe, expect, it } from 'vitest';
import { getInformWorkshopTaskSummaries } from '@/lib/utils/inspection-linked-tasks';
import type { LinkedInspectionTaskSummary } from '@/lib/client/inspection-links';

describe('getInformWorkshopTaskSummaries', () => {
  it('returns only workshop_vehicle_task links with formatted references', () => {
    const linkedTasks: LinkedInspectionTaskSummary[] = [
      {
        id: 'task-123456',
        action_type: 'workshop_vehicle_task',
        status: 'pending',
        created_at: '2026-04-15T09:00:00Z',
        logged_at: '2026-04-15T10:00:00Z',
        actioned_at: null,
      },
      {
        id: 'task-defect-654321',
        action_type: 'inspection_defect',
        status: 'completed',
        created_at: '2026-04-15T08:00:00Z',
        logged_at: '2026-04-15T08:30:00Z',
        actioned_at: '2026-04-15T12:00:00Z',
      },
    ];

    const result = getInformWorkshopTaskSummaries(linkedTasks, 'van');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'task-123456',
        suffix: '123456',
        href: '/workshop-tasks?taskId=task-123456&tab=van',
        created_at: '2026-04-15T09:00:00Z',
        logged_at: '2026-04-15T10:00:00Z',
        actioned_at: null,
      }),
    ]);
  });

  it('returns an empty array when no inform workshop task exists', () => {
    const linkedTasks: LinkedInspectionTaskSummary[] = [
      {
        id: 'task-defect-654321',
        action_type: 'inspection_defect',
        status: 'completed',
        created_at: '2026-04-15T08:00:00Z',
        logged_at: '2026-04-15T08:30:00Z',
        actioned_at: '2026-04-15T12:00:00Z',
      },
    ];

    expect(getInformWorkshopTaskSummaries(linkedTasks, 'plant')).toEqual([]);
  });
});
