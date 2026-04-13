import type { InspectionReferenceType } from '@/lib/utils/reference-ids';

export interface LinkedInspectionTaskSummary {
  id: string;
  action_type: string;
  status: string;
  created_at: string | null;
}

export async function fetchInspectionLinks(
  inspectionId: string,
  inspectionType: InspectionReferenceType
): Promise<LinkedInspectionTaskSummary[]> {
  const response = await fetch(
    `/api/inspection-links?inspectionId=${encodeURIComponent(inspectionId)}&inspectionType=${inspectionType}`
  );

  if (!response.ok) {
    throw new Error('Failed to fetch linked inspection tasks');
  }

  const payload = await response.json();
  return Array.isArray(payload.linkedTasks) ? payload.linkedTasks : [];
}
