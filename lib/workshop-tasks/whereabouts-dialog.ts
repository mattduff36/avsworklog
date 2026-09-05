import type {
  WorkshopAssetWhereaboutsEvent,
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

export function formatWhereaboutsEventPrimary(
  event: Pick<
    WorkshopAssetWhereaboutsEvent,
    'jobCode' | 'siteAddress' | 'customerName' | 'jobTitle' | 'driverName'
  >
): string {
  const jobCode = event.jobCode?.trim();
  if (jobCode) return jobCode;

  const siteAddress = event.siteAddress?.trim();
  if (siteAddress) return siteAddress;

  const catalogue = [event.customerName, event.jobTitle]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(' — ');
  if (catalogue) return catalogue;

  return 'No location recorded';
}
