import { formatDateTime } from '@/lib/utils/date';
import type { InspectionReferenceType } from '@/lib/utils/reference-ids';
import type { LinkedInspectionTaskSummary } from '@/lib/client/inspection-links';
import { getInformWorkshopTaskSummaries } from '@/lib/utils/inspection-linked-tasks';

interface InformWorkshopSummaryProps {
  linkedTasks: LinkedInspectionTaskSummary[];
  inspectionType: InspectionReferenceType;
}

function formatTaskTimestamp(value: string | null): string {
  return value ? formatDateTime(value) || 'Unavailable' : 'Not recorded';
}

export function InformWorkshopSummary({
  linkedTasks,
  inspectionType,
}: InformWorkshopSummaryProps) {
  const workshopTasks = getInformWorkshopTaskSummaries(linkedTasks, inspectionType);
  const workshopTask = workshopTasks[0] ?? null;
  const hasWorkshopTask = Boolean(workshopTask);

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-300/85 sm:text-sm">
      <dt className="text-slate-500 dark:text-slate-400/80">Inform workshop</dt>
      <dd className="text-right">{hasWorkshopTask ? 'Yes' : 'No'}</dd>
      <dt className="text-slate-500 dark:text-slate-400/80">Created</dt>
      <dd className="text-right">{formatTaskTimestamp(workshopTask?.created_at ?? null)}</dd>
      <dt className="text-slate-500 dark:text-slate-400/80">Started</dt>
      <dd className="text-right">{formatTaskTimestamp(workshopTask?.logged_at ?? null)}</dd>
      <dt className="text-slate-500 dark:text-slate-400/80">Completed</dt>
      <dd className="text-right">{formatTaskTimestamp(workshopTask?.actioned_at ?? null)}</dd>
    </dl>
  );
}
