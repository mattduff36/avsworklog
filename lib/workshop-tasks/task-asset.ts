import type { WorkshopAssetType } from '@/types/workshop-asset-whereabouts';

export interface WorkshopTaskAssetRef {
  assetType: WorkshopAssetType;
  assetId: string;
}

export function resolveWorkshopTaskAsset(task: {
  plant_id?: string | null;
  hgv_id?: string | null;
  van_id?: string | null;
}): WorkshopTaskAssetRef | null {
  if (task.plant_id) return { assetType: 'plant', assetId: task.plant_id };
  if (task.hgv_id) return { assetType: 'hgv', assetId: task.hgv_id };
  if (task.van_id) return { assetType: 'van', assetId: task.van_id };
  return null;
}
