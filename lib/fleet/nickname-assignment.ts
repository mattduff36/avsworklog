export type FleetNicknameAssignmentAction = 'keep' | 'clear' | 'assign';

export interface FleetNicknameAssignmentPayload {
  action: FleetNicknameAssignmentAction;
  userId?: string;
  expectedAssignmentId: string | null;
}

export interface CurrentAssetFleetAssignment {
  assignmentId: string;
  userId: string;
  fullName: string | null;
}

export function shouldPromptClearAssignment(params: {
  currentAssignment: CurrentAssetFleetAssignment | null;
  selectedUserId: string | null;
  nickname: string;
  initialNickname: string;
  selectionWasCleared: boolean;
}): boolean {
  if (!params.currentAssignment) return false;
  if (params.selectedUserId) return false;

  const nicknameChanged = params.nickname.trim() !== params.initialNickname.trim();
  if (!nicknameChanged && !params.selectionWasCleared) return false;

  // Nickname cleared/edited as free text, or an explicit user selection was cleared.
  return true;
}

export function buildAssignmentPayload(params: {
  selectedUserId: string | null;
  expectedAssignmentId: string | null;
  clearAssignment: boolean;
}): FleetNicknameAssignmentPayload {
  if (params.selectedUserId) {
    return {
      action: 'assign',
      userId: params.selectedUserId,
      expectedAssignmentId: params.expectedAssignmentId,
    };
  }

  if (params.clearAssignment) {
    return {
      action: 'clear',
      expectedAssignmentId: params.expectedAssignmentId,
    };
  }

  return {
    action: 'keep',
    expectedAssignmentId: params.expectedAssignmentId,
  };
}
