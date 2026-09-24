export interface ContractorTransitionRpcClient {
  rpc(
    fn: string,
    args: {
      p_profile_id: string;
      p_expected_role_id: string;
      p_contractor_role_id: string;
    }
  ): PromiseLike<{
    data: unknown;
    error: {
      code?: string;
      details?: string;
      message?: string;
    } | null;
  }>;
}

export interface ContractorTransitionResult {
  profileId: string;
  previousRoleId: string;
  contractorRoleId: string;
  removedAbsenceCount: number;
  zeroedCarryoverCount: number;
  clearedPermissionCount: number;
}

export class ContractorTransitionConflictError extends Error {
  readonly code: string;

  constructor(message: string, code = 'CONTRACTOR_TRANSITION_CONFLICT') {
    super(message);
    this.name = 'ContractorTransitionConflictError';
    this.code = code;
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseResult(data: unknown): ContractorTransitionResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Contractor transition returned an invalid result');
  }

  const result = data as Record<string, unknown>;
  if (
    typeof result.profileId !== 'string'
    || typeof result.previousRoleId !== 'string'
    || typeof result.contractorRoleId !== 'string'
    || !isNonNegativeInteger(result.removedAbsenceCount)
    || !isNonNegativeInteger(result.zeroedCarryoverCount)
    || !isNonNegativeInteger(result.clearedPermissionCount)
  ) {
    throw new Error('Contractor transition returned an invalid result');
  }

  return {
    profileId: result.profileId,
    previousRoleId: result.previousRoleId,
    contractorRoleId: result.contractorRoleId,
    removedAbsenceCount: result.removedAbsenceCount,
    zeroedCarryoverCount: result.zeroedCarryoverCount,
    clearedPermissionCount: result.clearedPermissionCount,
  };
}

export async function transitionProfileToContractor(
  supabaseAdmin: ContractorTransitionRpcClient,
  input: {
    profileId: string;
    expectedRoleId: string;
    contractorRoleId: string;
  }
): Promise<ContractorTransitionResult> {
  const { data, error } = await supabaseAdmin.rpc('transition_profile_to_contractor', {
    p_profile_id: input.profileId,
    p_expected_role_id: input.expectedRoleId,
    p_contractor_role_id: input.contractorRoleId,
  });

  if (error) {
    if (error.code === 'P0001') {
      throw new ContractorTransitionConflictError(
        error.message || 'Contractor transition is blocked',
        error.details || 'CONTRACTOR_TRANSITION_CONFLICT'
      );
    }
    throw new Error(error.message || 'Failed to transition profile to Contractor');
  }

  return parseResult(data);
}
