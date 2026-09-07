import { isArchivedWorkshopTask } from '@/lib/workshop-tasks/archive';

export function canEnableAttachmentCorrection(args: {
  canCorrectCompleted: boolean;
  task?: { status?: string | null; actioned_at?: string | null } | null;
  attachmentStatus?: string | null;
}): boolean {
  return Boolean(
    args.canCorrectCompleted
    && args.task?.status === 'completed'
    && args.attachmentStatus === 'completed'
    && !isArchivedWorkshopTask(args.task)
  );
}
