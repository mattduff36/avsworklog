export type TimesheetRenderVariant = 'plant-v2' | 'plant-legacy' | 'registry';

export function resolveTimesheetRenderVariant({
  existingId,
  existingTimesheetType,
  existingTemplateVersion,
  resolvedType,
}: {
  existingId: string | null;
  existingTimesheetType?: string | null;
  existingTemplateVersion?: number | null;
  resolvedType: string | null | undefined;
}): { variant: TimesheetRenderVariant; templateVersion: number; type: string | null | undefined } {
  const type = (existingId ? existingTimesheetType : resolvedType) || resolvedType;
  const templateVersion = existingId
    ? (existingTemplateVersion || 1)
    : (type === 'plant' ? 2 : 1);

  if (type === 'plant' && templateVersion === 2) {
    return { variant: 'plant-v2', templateVersion, type };
  }

  if (type === 'plant') {
    return { variant: 'plant-legacy', templateVersion, type };
  }

  return { variant: 'registry', templateVersion, type };
}
