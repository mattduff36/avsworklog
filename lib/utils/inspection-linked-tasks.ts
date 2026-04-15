import type { LinkedInspectionTaskSummary } from '@/lib/client/inspection-links';
import {
  getReferenceIdSuffix,
  getWorkshopTaskHref,
  type InspectionReferenceType,
} from '@/lib/utils/reference-ids';

export interface InformWorkshopTaskSummary extends LinkedInspectionTaskSummary {
  suffix: string;
  href: string;
}

export function getInformWorkshopTaskSummaries(
  linkedTasks: LinkedInspectionTaskSummary[],
  inspectionType: InspectionReferenceType
): InformWorkshopTaskSummary[] {
  return linkedTasks
    .filter((task) => task.action_type === 'workshop_vehicle_task')
    .map((task) => {
      const suffix = getReferenceIdSuffix(task.id);
      const href = getWorkshopTaskHref(task.id, inspectionType);

      return suffix && href
        ? {
            ...task,
            suffix,
            href,
          }
        : null;
    })
    .filter((task): task is InformWorkshopTaskSummary => Boolean(task));
}
