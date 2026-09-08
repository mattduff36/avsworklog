export interface DeleteUserAnnualLeaveRpcClient {
  rpc(
    fn: string,
    args: { p_profile_id: string }
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export async function removeOpenYearAnnualLeaveBookingsForProfile(
  supabaseAdmin: DeleteUserAnnualLeaveRpcClient,
  profileId: string
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc(
    'delete_profile_open_year_annual_leave_bookings',
    { p_profile_id: profileId }
  );

  if (error) {
    throw new Error(error.message || 'Failed to remove booked annual leave');
  }

  if (typeof data !== 'number' || !Number.isFinite(data) || data < 0) {
    throw new Error('Annual leave cleanup returned an invalid count');
  }

  return data;
}
