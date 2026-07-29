import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { applyNicknameAssignmentFromBody } from './apply-fleet-nickname-assignment-from-body';
import type { FleetAssetType } from './fleet-nickname-assignment';

type AdminClient = SupabaseClient<Database>;

export async function applyCreateFleetNicknameAssignment(params: {
  admin: AdminClient;
  body: unknown;
  assetType: FleetAssetType;
  assetId: string;
  actorUserId: string;
  table: 'vans' | 'hgvs' | 'plant';
}): Promise<{ error?: string; status?: number; result?: unknown }> {
  const hasAssignment =
    params.body &&
    typeof params.body === 'object' &&
    'assignment' in params.body &&
    (params.body as { assignment?: unknown }).assignment != null;

  if (!hasAssignment) {
    return {};
  }

  const assignmentUpdate = await applyNicknameAssignmentFromBody({
    admin: params.admin,
    body: {
      ...(params.body as object),
      assignment: {
        ...((params.body as { assignment: object }).assignment),
        expectedAssignmentId: null,
      },
    },
    assetType: params.assetType,
    assetId: params.assetId,
    actorUserId: params.actorUserId,
  });

  if (assignmentUpdate.error) {
    const { error: deleteError } = await params.admin.from(params.table).delete().eq('id', params.assetId);
    if (deleteError) {
      console.error(
        `Failed to compensate ${params.assetType} create after assignment failure:`,
        deleteError
      );
      return {
        error: `${assignmentUpdate.error}. Asset was created but assignment failed and cleanup also failed — contact support.`,
        status: 500,
      };
    }
    return {
      error: assignmentUpdate.error,
      status: assignmentUpdate.status || 400,
    };
  }

  return { result: assignmentUpdate.result };
}
