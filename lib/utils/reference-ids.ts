export type InspectionReferenceType = 'van' | 'hgv' | 'plant';

export function getReferenceIdSuffix(id?: string | null): string | null {
  const value = id?.trim();
  if (!value) {
    return null;
  }

  return value.slice(-6);
}

export function formatReferenceId(id?: string | null): string | null {
  const suffix = getReferenceIdSuffix(id);
  return suffix ? `ID ${suffix}` : null;
}

export function getInspectionHref(
  inspectionType: InspectionReferenceType,
  inspectionId?: string | null
): string | null {
  if (!inspectionId) {
    return null;
  }

  if (inspectionType === 'hgv') {
    return `/hgv-inspections/${inspectionId}`;
  }

  if (inspectionType === 'plant') {
    return `/plant-inspections/${inspectionId}`;
  }

  return `/van-inspections/${inspectionId}`;
}

export function getWorkshopTaskHref(
  taskId?: string | null,
  inspectionType?: InspectionReferenceType | null
): string | null {
  if (!taskId) {
    return null;
  }

  const params = new URLSearchParams();
  params.set('taskId', taskId);

  if (inspectionType) {
    params.set('tab', inspectionType);
  }

  return `/workshop-tasks?${params.toString()}`;
}
