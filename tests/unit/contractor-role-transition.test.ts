import { describe, expect, it, vi } from 'vitest';
import {
  ContractorTransitionConflictError,
  transitionProfileToContractor,
} from '@/lib/server/contractor-role-transition';

const input = {
  profileId: 'profile-1',
  expectedRoleId: 'employee-role',
  contractorRoleId: 'contractor-role',
};

describe('transitionProfileToContractor', () => {
  it('calls the RPC with the concurrency guard and returns validated counts', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profileId: 'profile-1',
        previousRoleId: 'employee-role',
        contractorRoleId: 'contractor-role',
        removedAbsenceCount: 2,
        zeroedCarryoverCount: 1,
        clearedPermissionCount: 3,
      },
      error: null,
    });

    await expect(transitionProfileToContractor({ rpc }, input)).resolves.toMatchObject({
      removedAbsenceCount: 2,
      clearedPermissionCount: 3,
    });
    expect(rpc).toHaveBeenCalledWith('transition_profile_to_contractor', {
      p_profile_id: 'profile-1',
      p_expected_role_id: 'employee-role',
      p_contractor_role_id: 'contractor-role',
    });
  });

  it('turns database preflight failures into typed conflicts', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        details: 'AMBIGUOUS_ANNUAL_LEAVE',
        message: 'Contractor transition blocked',
      },
    });

    const result = transitionProfileToContractor({ rpc }, input);
    await expect(result).rejects.toBeInstanceOf(ContractorTransitionConflictError);
    await expect(result).rejects.toMatchObject({ code: 'AMBIGUOUS_ANNUAL_LEAVE' });
  });

  it('rejects malformed RPC success payloads', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { removedAbsenceCount: -1 },
      error: null,
    });

    await expect(transitionProfileToContractor({ rpc }, input)).rejects.toThrow(
      /invalid result/
    );
  });
});
