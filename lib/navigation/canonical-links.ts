export function dailyAllocationJobSheetHref(jobCode: string): string {
  return `/daily-allocation/jobs/${encodeURIComponent(jobCode)}`;
}

export function fleetPlantHistoryHref(plantId: string): string {
  return `/fleet/plant/${encodeURIComponent(plantId)}/history`;
}

export function plantInspectionHref(inspectionId: string): string {
  return `/plant-inspections/${encodeURIComponent(inspectionId)}`;
}

export function quoteHref(quoteId: string): string {
  return `/quotes/${encodeURIComponent(quoteId)}`;
}
