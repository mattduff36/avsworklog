import type { InventoryAdminClient } from './inventory-locations';
import {
  applyFleetAssetNicknameAssignment,
  isStaleAssignmentError,
  parseFleetNicknameAssignmentIntent,
  type FleetAssetType,
  type FleetNicknameAssignmentResult,
} from './fleet-nickname-assignment';

export interface ApplyNicknameAssignmentFromBodyResult {
  applied: boolean;
  result?: FleetNicknameAssignmentResult;
  error?: string;
  status?: number;
}

export async function applyNicknameAssignmentFromBody(params: {
  admin: InventoryAdminClient;
  body: unknown;
  assetType: FleetAssetType;
  assetId: string;
  actorUserId: string;
  fallbackNickname?: string | null;
}): Promise<ApplyNicknameAssignmentFromBodyResult> {
  let intent;
  try {
    intent = parseFleetNicknameAssignmentIntent(params.body);
  } catch (error) {
    return {
      applied: false,
      error: error instanceof Error ? error.message : 'Invalid assignment payload',
      status: 400,
    };
  }

  if (!intent) {
    return { applied: false };
  }

  const bodyNickname =
    params.body && typeof params.body === 'object' && 'nickname' in params.body
      ? (params.body as { nickname?: unknown }).nickname
      : undefined;

  const manualNickname =
    bodyNickname === undefined
      ? params.fallbackNickname ?? null
      : typeof bodyNickname === 'string'
        ? bodyNickname.trim() || null
        : bodyNickname === null
          ? null
          : params.fallbackNickname ?? null;

  try {
    const result = await applyFleetAssetNicknameAssignment(params.admin, {
      assetType: params.assetType,
      assetId: params.assetId,
      manualNickname,
      assignment: intent,
      actorUserId: params.actorUserId,
    });
    return { applied: true, result };
  } catch (error) {
    if (isStaleAssignmentError(error)) {
      return {
        applied: false,
        error: 'Current assignment changed. Refresh and try again.',
        status: 409,
      };
    }
    return {
      applied: false,
      error: error instanceof Error ? error.message : 'Failed to update nickname assignment',
      status: 400,
    };
  }
}
