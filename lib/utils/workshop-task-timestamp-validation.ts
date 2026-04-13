import type { WorkshopTaskTimelineItem } from '@/lib/utils/workshopTaskTimeline';

export interface TimestampValidationItem {
  timelineItemId: string;
  type: WorkshopTaskTimelineItem['type'];
  created_at: string;
}

export function parseTimestamp(timestamp: string): Date | null {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function validateWorkshopTaskTimestampAdjustment(
  items: TimestampValidationItem[],
  targetTimelineItemId: string,
  nextTimestamp: string
): string | null {
  const parsedNextTimestamp = parseTimestamp(nextTimestamp);

  if (!parsedNextTimestamp) {
    return 'Please provide a valid date and time.';
  }

  const targetIndex = items.findIndex((item) => item.timelineItemId === targetTimelineItemId);
  if (targetIndex === -1) {
    return 'The selected timeline item could not be found.';
  }

  const previousItem = targetIndex > 0 ? items[targetIndex - 1] : null;
  const nextItem = targetIndex < items.length - 1 ? items[targetIndex + 1] : null;
  const nextMs = parsedNextTimestamp.getTime();

  if (previousItem) {
    const previousMs = parseTimestamp(previousItem.created_at)?.getTime();
    if (typeof previousMs === 'number' && nextMs < previousMs) {
      return 'Timestamp cannot be before the previous timeline event.';
    }
  }

  if (nextItem) {
    const nextItemMs = parseTimestamp(nextItem.created_at)?.getTime();
    if (typeof nextItemMs === 'number' && nextMs > nextItemMs) {
      return 'Timestamp cannot be after the next timeline event.';
    }
  }

  return null;
}
