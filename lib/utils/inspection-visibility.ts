export function hasWorkshopInspectionFullVisibilityOverride(
  teamName: string | null | undefined
): boolean {
  const normalizedTeamName = (teamName || '').trim().toLowerCase();
  return normalizedTeamName === 'workshop';
}
