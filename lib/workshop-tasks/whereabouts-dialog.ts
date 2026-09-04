import type {
  WorkshopAssetWhereaboutsPayload,
} from '@/types/workshop-asset-whereabouts';
import type { WorkshopTaskAssetRef } from '@/lib/workshop-tasks/task-asset';

export function isWhereaboutsPayloadForAsset(
  payload: WorkshopAssetWhereaboutsPayload | null | undefined,
  asset: WorkshopTaskAssetRef | null | undefined
): payload is WorkshopAssetWhereaboutsPayload {
  return Boolean(
    payload &&
      asset &&
      payload.asset.id === asset.assetId &&
      payload.asset.type === asset.assetType
  );
}

export function resolveWhereaboutsMapTarget(
  asset: WorkshopTaskAssetRef | null,
  payload: WorkshopAssetWhereaboutsPayload | null
): {
  plantId?: string;
  regNumber?: string;
  assetLabel: string;
  locationProvider: 'fleetsmart' | 'velocityfleet';
} | null {
  if (!asset || !isWhereaboutsPayloadForAsset(payload, asset)) return null;
  return {
    plantId: payload.asset.plantId || undefined,
    regNumber: payload.asset.regNumber || undefined,
    assetLabel: payload.asset.label,
    locationProvider: asset.assetType === 'van' ? 'velocityfleet' : 'fleetsmart',
  };
}
