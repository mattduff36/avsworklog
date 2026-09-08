import { describe, expect, it, vi } from 'vitest';
import { removeOpenYearAnnualLeaveBookingsForProfile } from '@/lib/server/delete-user-annual-leave';

describe('annual leave cleanup helper', () => {
  it('DEL-AL-04: zero matching rows is success and invalid RPC results fail closed', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 0, error: null });

    await expect(
      removeOpenYearAnnualLeaveBookingsForProfile({ rpc }, 'user-1')
    ).resolves.toBe(0);
    expect(rpc).toHaveBeenCalledWith('delete_profile_open_year_annual_leave_bookings', {
      p_profile_id: 'user-1',
    });

    await expect(
      removeOpenYearAnnualLeaveBookingsForProfile(
        { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'Annual leave reason is missing or ambiguous' } }) },
        'user-1'
      )
    ).rejects.toThrow('Annual leave reason is missing or ambiguous');

    await expect(
      removeOpenYearAnnualLeaveBookingsForProfile(
        { rpc: vi.fn().mockResolvedValue({ data: 'nope', error: null }) },
        'user-1'
      )
    ).rejects.toThrow('invalid count');
  });
});
