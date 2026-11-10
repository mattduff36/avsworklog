import type { InspectionAssetType } from '@/lib/inspections/meter-correction';

export function dailyCheckEffectSource(assetType: InspectionAssetType, inspectionId: string) {
  return { daily_check_source_id: inspectionId, daily_check_source_type: assetType };
}
